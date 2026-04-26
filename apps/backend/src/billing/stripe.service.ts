import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { PLANS, PlanCode } from '../common/plans';
import Stripe from 'stripe';

/**
 * Stripe integration layer.
 *
 * Initialization is lazy + null-safe: if STRIPE_SECRET_KEY is not set in
 * the environment (which is the case in dev today and on the VM until
 * cloud migration), the service constructs but every method returns
 * "not configured" errors instead of crashing the boot. That lets the
 * BillingController stay on the wire and lets `/billing/plans` +
 * `/billing/usage` keep working while Stripe is a no-op.
 *
 * Two Stripe price-id sources:
 *   1. Env vars (preferred for prod/staging):
 *        STRIPE_PRICE_BUSINESS_MONTHLY=price_xxx
 *        STRIPE_PRICE_PRO_MONTHLY=price_xxx
 *        STRIPE_PRICE_ENTERPRISE_MONTHLY=price_xxx
 *   2. Per-plan PlanDef.stripePriceIdMonthly (fallback for explicit overrides)
 *
 * SCHEMA DEPENDENCY:
 *   This service writes to Organization.stripeCustomerId (already exists)
 *   and reads/writes Organization.stripeSubscriptionId,
 *   Organization.subscriptionStatus, Organization.currentPeriodEnd,
 *   Organization.trialEndsAt — those four are in the PENDING schema
 *   migration (apps/backend/prisma/PENDING_MIGRATION_unify_plans_oauth_reveals.diff).
 *   Until that migration runs, the create/update branches that touch
 *   the new columns are commented out and the methods return early.
 *   Marked with `// PENDING-MIGRATION:` so they're easy to grep.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly webhookSecret: string;
  private readonly priceIds: Partial<Record<PlanCode, string>>;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || '';

    this.priceIds = {
      BUSINESS: this.configService.get<string>('STRIPE_PRICE_BUSINESS_MONTHLY') || PLANS.BUSINESS.stripePriceIdMonthly,
      PRO: this.configService.get<string>('STRIPE_PRICE_PRO_MONTHLY') || PLANS.PRO.stripePriceIdMonthly,
      ENTERPRISE: this.configService.get<string>('STRIPE_PRICE_ENTERPRISE_MONTHLY') || PLANS.ENTERPRISE.stripePriceIdMonthly,
    };

    if (!apiKey) {
      this.logger.warn('STRIPE_SECRET_KEY not set — billing endpoints will return 503 until configured.');
      this.stripe = null;
    } else {
      this.stripe = new Stripe(apiKey, { apiVersion: '2025-01-27.acacia' as any });
    }
  }

  isConfigured(): boolean {
    return this.stripe !== null;
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new InternalServerErrorException(
        'Stripe is not configured on this environment. Set STRIPE_SECRET_KEY.',
      );
    }
    return this.stripe;
  }

  /**
   * Idempotent: returns the org's existing stripeCustomerId if set, else
   * creates a new Stripe Customer and persists the id.
   */
  async ensureCustomer(orgId: string, email: string, orgName: string): Promise<string> {
    const stripe = this.requireStripe();
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new BadRequestException('Organization not found');
    if (org.stripeCustomerId) return org.stripeCustomerId;

    const customer = await stripe.customers.create({
      email,
      name: orgName,
      metadata: { orgId },
    });

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  /**
   * Build a Checkout Session for one of the paid plans. Caller is
   * responsible for redirecting the browser to session.url.
   */
  async createCheckoutSession(opts: {
    orgId: string;
    email: string;
    orgName: string;
    planCode: PlanCode;
    billingCycle: 'monthly' | 'annual';
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    const stripe = this.requireStripe();
    if (opts.planCode === 'SCOUT') {
      throw new BadRequestException('Scout is the free tier — no checkout required.');
    }

    const priceId = this.priceIds[opts.planCode];
    if (!priceId) {
      throw new BadRequestException(
        `Stripe price id for ${opts.planCode} is not configured. Set STRIPE_PRICE_${opts.planCode}_MONTHLY in env.`,
      );
    }

    const customerId = await this.ensureCustomer(opts.orgId, opts.email, opts.orgName);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      subscription_data: {
        trial_period_days: 14,
        metadata: { orgId: opts.orgId, planCode: opts.planCode },
      },
      metadata: { orgId: opts.orgId, planCode: opts.planCode },
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new InternalServerErrorException('Stripe did not return a checkout URL.');
    }
    return { url: session.url, sessionId: session.id };
  }

  /**
   * Build a Customer Portal session for the org's existing customer.
   * Used by Settings → Billing "Manage Subscription" button.
   */
  async createPortalSession(opts: { orgId: string; returnUrl: string }): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const org = await this.prisma.organization.findUnique({ where: { id: opts.orgId } });
    if (!org?.stripeCustomerId) {
      throw new BadRequestException('Organization has no Stripe customer on file. Complete checkout first.');
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: opts.returnUrl,
    });
    return { url: session.url };
  }

  /**
   * Verify Stripe webhook signature and dispatch to the right handler.
   * The body passed in MUST be the raw request buffer (NOT pre-parsed JSON)
   * for signature verification to work.
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<{ received: true; eventType: string }> {
    const stripe = this.requireStripe();
    if (!this.webhookSecret) {
      throw new InternalServerErrorException('STRIPE_WEBHOOK_SECRET not configured.');
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err: any) {
      this.logger.warn(`Webhook signature verification failed: ${err?.message}`);
      throw new BadRequestException('Invalid Stripe signature');
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.markSubscriptionCanceled(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        // Hook for resetting reveal-meter period counters on each renewal.
        await this.onInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await this.onInvoiceFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        // Other events ignored for now.
        this.logger.log(`Unhandled webhook type: ${event.type}`);
    }

    return { received: true, eventType: event.type };
  }

  // -------------------------------------------------------------------------
  // Internal — webhook handlers
  // -------------------------------------------------------------------------

  private async syncSubscription(sub: Stripe.Subscription): Promise<void> {
    const orgId = (sub.metadata?.orgId as string | undefined) ?? null;
    const planCode = (sub.metadata?.planCode as PlanCode | undefined) ?? null;
    if (!orgId) {
      this.logger.warn(`Subscription ${sub.id} has no orgId metadata — cannot sync.`);
      return;
    }

    // PENDING-MIGRATION: stripeSubscriptionId, subscriptionStatus, currentPeriodEnd
    // columns land with the schema migration. Until then we can only persist
    // the planCode change. After the migration, uncomment the full update.
    const data: any = {};
    if (planCode) data.plan = planCode as any;
    // data.stripeSubscriptionId = sub.id;
    // data.subscriptionStatus = sub.status === 'active' ? 'ACTIVE'
    //   : sub.status === 'trialing' ? 'TRIALING'
    //   : sub.status === 'past_due' ? 'PAST_DUE'
    //   : sub.status === 'canceled' ? 'CANCELED'
    //   : 'NONE';
    // data.currentPeriodEnd = new Date(sub.current_period_end * 1000);
    // data.trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

    if (Object.keys(data).length > 0) {
      await this.prisma.organization.update({ where: { id: orgId }, data });
    }
    this.logger.log(`Synced subscription ${sub.id} for org ${orgId} (plan=${planCode || 'unchanged'}, status=${sub.status})`);
  }

  private async markSubscriptionCanceled(sub: Stripe.Subscription): Promise<void> {
    const orgId = (sub.metadata?.orgId as string | undefined) ?? null;
    if (!orgId) return;
    // PENDING-MIGRATION: subscriptionStatus column.
    // await this.prisma.organization.update({
    //   where: { id: orgId },
    //   data: { subscriptionStatus: 'CANCELED' },
    // });
    this.logger.log(`Subscription ${sub.id} canceled for org ${orgId} — would set subscriptionStatus=CANCELED post-migration.`);
  }

  private async onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    // Hook for: (1) recording the invoice, (2) resetting reveal-meter period
    // counters in lockstep with Stripe's billing period. Both are pending
    // the schema migration.
    this.logger.log(`Invoice ${invoice.id} paid for customer ${invoice.customer} — period reset hook pending migration.`);
  }

  private async onInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
    this.logger.warn(`Invoice ${invoice.id} payment failed for customer ${invoice.customer}.`);
  }
}
