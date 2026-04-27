import { Controller, Get, Post, Body, Req, Res, Headers, UseGuards, HttpCode, HttpException, HttpStatus, RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRoles } from '../auth/roles.decorator';
import { PLANS, PLAN_ORDER_LIST } from './plan-list';
import { RevealMeterService } from '../properties/reveal-meter.service';
import { StripeService } from './stripe.service';
import { PlanCode } from '../common/plans';

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
  @OrgRoles('OWNER', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe Checkout session — owner/admin only' })
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
  @OrgRoles('OWNER', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the Stripe Customer Portal URL — owner/admin only' })
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
      // Quietly accept the webhook so Stripe doesn't retry storms.
      return res.status(503).json({ message: 'Stripe not configured' });
    }
    if (!signature) {
      return res.status(400).json({ message: 'Missing Stripe signature header' });
    }
    if (!req.rawBody) {
      // Should never hit this with NestFactory.create(AppModule, { rawBody: true }).
      return res.status(500).json({ message: 'Server misconfigured: rawBody unavailable' });
    }
    try {
      const result = await this.stripeService.handleWebhook(req.rawBody, signature);
      return res.status(200).json(result);
    } catch (err: any) {
      const status = err?.status || 500;
      // Never echo the raw error message to the world — could leak internals.
      const message =
        status === 400
          ? 'Invalid Stripe signature'
          : status >= 500
            ? 'webhook handler failed'
            : err?.message || 'webhook error';
      return res.status(status).json({ message });
    }
  }
}
