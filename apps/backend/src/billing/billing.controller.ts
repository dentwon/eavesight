import { Controller, Get, Post, Body, Req, UseGuards, HttpCode, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PLANS, PLAN_ORDER_LIST } from './plan-list';
import { RevealMeterService } from '../properties/reveal-meter.service';

/**
 * BillingController — skeleton.
 *
 * Stripe is intentionally NOT wired up here yet (the user has decided to defer
 * Stripe until the cloud migration). This controller exposes:
 *
 *   - GET  /billing/plans         — public plan catalog (frontend reads this)
 *   - GET  /billing/usage         — authed usage snapshot for current org
 *   - POST /billing/checkout      — 501 (will create Stripe Checkout session)
 *   - POST /billing/portal        — 501 (will return Stripe Customer Portal URL)
 *   - POST /billing/webhook       — 501 (Stripe → us; verify signature, sync sub state)
 *
 * The route shapes match what the Stripe wiring will need so the cloud
 * cutover is a fill-in-the-stubs change with no controller refactor.
 */
@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly revealMeter: RevealMeterService) {}

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
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'Create a Stripe Checkout session — NOT IMPLEMENTED until cloud migration' })
  checkout(@Req() _req: any, @Body() _body: { planCode: string; billingCycle?: 'monthly' | 'annual' }) {
    throw new HttpException(
      { message: 'Stripe checkout not yet wired. Scheduled for cloud migration.', planCode: _body?.planCode },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'Get the Stripe Customer Portal URL — NOT IMPLEMENTED until cloud migration' })
  portal() {
    throw new HttpException(
      { message: 'Stripe customer portal not yet wired. Scheduled for cloud migration.' },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'Stripe webhook receiver — NOT IMPLEMENTED until cloud migration' })
  webhook(@Body() _body: any) {
    throw new HttpException(
      { message: 'Stripe webhook not yet wired. Scheduled for cloud migration.' },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
