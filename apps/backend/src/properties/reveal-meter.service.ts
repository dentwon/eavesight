import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { resolvePlan, PlanDef } from '../common/plans';

export type RevealKind = 'reveal' | 'roof_measurement';

export interface RevealCheck {
  allowed: boolean;
  alreadyRevealed: boolean; // true if this org has revealed this property in the current period (no quota cost)
  remainingThisPeriod: number;
  quota: number;
  plan: PlanDef;
  reason?: string;
}

const COST_CENTS: Record<RevealKind, number> = {
  reveal: 6, // $0.04 Tracerfy + $0.02 DNC scrub
  roof_measurement: 5,
};

const PII_FIELDS = ['ownerPhone', 'ownerPhone2', 'ownerEmail', 'ownerEmail2', 'ownerMailAddress', 'ownerMailCity', 'ownerMailState', 'ownerMailZip', 'ownerFullName', 'ownerFirstName', 'ownerLastName'] as const;
type PiiField = typeof PII_FIELDS[number];

@Injectable()
export class RevealMeterService {
  private readonly logger = new Logger(RevealMeterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check whether an org may reveal this property right now, and return how
   * many reveals they have left this period.
   *
   * "Already revealed" = same org revealed same property since
   * `currentPeriodStart` (= start of current calendar month until Stripe
   * webhooks populate Organization.currentPeriodStart). Already-revealed
   * properties cost no quota — repeat views of the same address are free.
   */
  async checkReveal(orgId: string, propertyId: string, kind: RevealKind = 'reveal'): Promise<RevealCheck> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    const plan = resolvePlan(org?.plan as any);
    const quota = kind === 'reveal' ? plan.revealQuota : plan.roofMeasurementQuota;
    // Hard cap: only meaningful for `reveal` and only on plans that have one
    // (Scout = 25). Plans without a ceiling pass `null` and are uncapped on
    // overage; their fair-use ceiling is a sales conversation, not a block.
    const overageEnabled = kind === 'reveal' && plan.overageRevealCents != null;
    const hardCap = kind === 'reveal' ? plan.fairUseRevealCeiling : null;

    const periodStart = currentPeriodStart();

    const alreadyRevealed = await this.prisma.apiUsage.findFirst({
      where: {
        orgId,
        service: serviceFor(kind),
        propertyId,
        createdAt: { gte: periodStart },
      },
      select: { id: true },
    });

    const usedThisPeriod = await this.prisma.apiUsage.count({
      where: {
        orgId,
        service: serviceFor(kind),
        propertyId: { not: null },
        createdAt: { gte: periodStart },
      },
    });

    const remaining = Math.max(0, quota - usedThisPeriod);

    if (alreadyRevealed) {
      return { allowed: true, alreadyRevealed: true, remainingThisPeriod: remaining, quota, plan };
    }

    // Hard cap blocks even paid overage. Only set on Scout (25/mo) right now.
    if (hardCap != null && usedThisPeriod >= hardCap) {
      return {
        allowed: false,
        alreadyRevealed: false,
        remainingThisPeriod: 0,
        quota,
        plan,
        reason: `You've used all ${hardCap} reveals this month on the ${plan.name} plan. Upgrade to Business for 50 reveals included + $1.00 each beyond.`,
      };
    }

    // Quota exhausted but plan allows paid overage — let it through (will be
    // charged at plan.overageRevealCents on next invoice once Stripe is wired).
    if (usedThisPeriod >= quota) {
      if (overageEnabled) {
        return {
          allowed: true,
          alreadyRevealed: false,
          remainingThisPeriod: 0,
          quota,
          plan,
          reason: `Over included quota — billed at ${plan.overageRevealCents}¢ per reveal.`,
        };
      }
      return {
        allowed: false,
        alreadyRevealed: false,
        remainingThisPeriod: 0,
        quota,
        plan,
        reason: `Reveal quota exhausted (${usedThisPeriod}/${quota} used this period). Upgrade your plan or wait until next billing period.`,
      };
    }
    return { allowed: true, alreadyRevealed: false, remainingThisPeriod: remaining - 1, quota, plan };
  }

  /**
   * Record a billable reveal. Idempotent within a billing period — calling
   * twice for the same (orgId, propertyId, kind, period) only logs once.
   */
  async recordReveal(orgId: string, userId: string, propertyId: string, kind: RevealKind = 'reveal'): Promise<void> {
    const periodStart = currentPeriodStart();
    const existing = await this.prisma.apiUsage.findFirst({
      where: {
        orgId,
        service: serviceFor(kind),
        propertyId,
        createdAt: { gte: periodStart },
      },
      select: { id: true },
    });
    if (existing) return;
    try {
      await this.prisma.apiUsage.create({
        data: {
          orgId,
          service: serviceFor(kind),
          endpoint: kind === 'reveal' ? 'property_reveal' : 'roof_measurement',
          credits: 1,
          costCents: COST_CENTS[kind],
          propertyId,
          metadata: { revealedBy: userId, kind },
        },
      });
    } catch (err: any) {
      this.logger.warn(`recordReveal failed for org=${orgId} prop=${propertyId}: ${err?.message}`);
    }
  }

  /**
   * Strip PII fields from a property record. Used when a viewer has not
   * revealed (or cannot reveal) this property.
   */
  maskPii<T extends Record<string, any>>(property: T | null): T | null {
    if (!property) return property;
    const masked: any = { ...property };
    for (const f of PII_FIELDS) {
      if (f in masked) masked[f as PiiField] = null;
    }
    masked.ownerMasked = true;
    return masked as T;
  }

  /**
   * Get usage summary for an org (used by Settings → Billing tab).
   */
  async getUsage(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    const plan = resolvePlan(org?.plan as any);
    const periodStart = currentPeriodStart();

    const [reveals, roofs] = await Promise.all([
      this.prisma.apiUsage.count({
        where: { orgId, service: 'reveal', propertyId: { not: null }, createdAt: { gte: periodStart } },
      }),
      this.prisma.apiUsage.count({
        where: { orgId, service: 'roof_measurement', propertyId: { not: null }, createdAt: { gte: periodStart } },
      }),
    ]);

    return {
      plan: plan.code,
      planName: plan.name,
      periodStart,
      periodEnd: nextPeriodStart(periodStart),
      reveals: { used: reveals, quota: plan.revealQuota, remaining: Math.max(0, plan.revealQuota - reveals) },
      roofMeasurements: { used: roofs, quota: plan.roofMeasurementQuota, remaining: Math.max(0, plan.roofMeasurementQuota - roofs) },
      overageRevealCents: plan.overageRevealCents,
    };
  }
}

function serviceFor(kind: RevealKind): string {
  return kind === 'reveal' ? 'reveal' : 'roof_measurement';
}

function currentPeriodStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function nextPeriodStart(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth() + 1, 1);
}
