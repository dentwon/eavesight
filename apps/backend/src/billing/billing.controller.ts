import { Controller, Get, Post, Body, Req, Res, Headers, UseGuards, HttpCode, HttpException, HttpStatus, RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PLANS, PLAN_ORDER_LIST } from './plan-list';
import { RevealMeterService } from '../properties/reveal-meter.service';
import { StripeService } from './stripe.service';
import { PlanCode } from '../common/plans';

/**
 * BillingController — Stripe-integrated.
 *
 * Public endpoints:
 *   - GET  /billing/plans      public plan catalog
 *   - POST /billing/webhook    Stripe → us (signature-verified)
 *
 * Authed endpoints:
 *   - GET  /billing/usage      current org's billing-period usage
 *   - POST /billing/checkout   start a Stripe Checkout session
 *   - POST /billing/portal     get a Stripe Customer Portal URL
 *
 * If STRIPE_SECRET_KEY is unset (current state on the VM until cloud
 * migration), the Stripe-touching endpoints return 503 with a clear
 * "Stripe not configured" message instead of crashing. /plans + /usage
 * keep working regardless.
 */
@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly revealMeter: RevealMeterService,
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
  ) {}

  @Get('plans')
  @Public()
  @ApiOperation({ summary: 'Get the public catalog of subscription tiers' })
  getPlans() {
    return { plans: PLAN_ORDER_LIST.map((code) => PLANS[code]) };
  }

  @Get('usage')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current org\'s billing-period usage (reveals + roof measurements)' })
  getUsage(@Req() req: any) {
    if (!req.user?.orgId) {
      throw new HttpException('No organization context', HttpStatus.BAD_REQUEST);
    }
    return this.revealMeter.getUsage(req.user.orgId);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe Checkout session for a paid plan' })
  async checkout(
    @Req() req: any,
    @Body() body: { planCode: PlanCode; billingCycle?: 'monthly' | 'annual' },
  ) {
    if (!this.stripeService.isConfigured()) {
      throw new HttpException(
        { message: 'Stripe not configured on this environment.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!req.user?.orgId) {
      throw new HttpException('No organization context', HttpStatus.BAD_REQUEST);
    }
    const appUrl = this.configService.get<string>('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000';
    return this.stripeService.createCheckoutSession({
      orgId: req.user.orgId,
      email: req.user.email,
      orgName: req.user.firstName ? `${req.user.firstName}'s org` : 'Eavesight org',
      planCode: body.planCode,
      billingCycle: body.billingCycle || 'monthly',
      successUrl: `${appUrl}/dashboard/settings?billing=success`,
      cancelUrl: `${appUrl}/dashboard/settings?billing=canceled`,
    });
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the Stripe Customer Portal URL for managing subscription' })
  async portal(@Req() req: any) {
    if (!this.stripeService.isConfigured()) {
      throw new HttpException(
        { message: 'Stripe not configured on this environment.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!req.user?.orgId) {
      throw new HttpException('No organization context', HttpStatus.BAD_REQUEST);
    }
    const appUrl = this.configService.get<string>('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000';
    return this.stripeService.createPortalSession({
      orgId: req.user.orgId,
      returnUrl: `${appUrl}/dashboard/settings`,
    });
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook receiver — verifies signature, syncs subscription state' })
  async webhook(
    @Req() req: RawBodyRequest<any>,
    @Headers('stripe-signature') signature: string,
    @Res() res: Response,
  ) {
    if (!this.stripeService.isConfigured()) {
      // Quietly accept the webhook so Stripe doesn't retry, but log + 503.
      // In prod this should fail loudly; in dev/staging without Stripe wired
      // we'd rather not get retry storms.
      return res.status(503).json({ message: 'Stripe not configured' });
    }
    if (!signature) {
      return res.status(400).json({ message: 'Missing Stripe signature header' });
    }
    if (!req.rawBody) {
      return res.status(400).json({
        message: 'Raw body unavailable. Ensure NestJS bootstrap uses { rawBody: true }.',
      });
    }
    try {
      const result = await this.stripeService.handleWebhook(req.rawBody, signature);
      return res.status(200).json(result);
    } catch (err: any) {
      const status = err?.status || 500;
      return res.status(status).json({ message: err?.message || 'webhook error' });
    }
  }
}
