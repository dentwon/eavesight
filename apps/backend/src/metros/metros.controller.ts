import { Controller, Get, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { MetrosService, FilterOpts } from './metros.service';
import type { Request } from 'express';

/**
 * Metro-scoped read endpoints. Every route is parameterized by :code so that
 * adding a new market (nashville, austin, atlanta, ...) is one row in metros
 * table — zero code changes.
 *
 * Pin-card tier gating:
 *   - Anyone authenticated can request tier=free (masked owner info).
 *   - tier=pro payload is only served to users with the 'pro' entitlement
 *     (currently mapped from role = ADMIN | SUPER_ADMIN until the Stripe +
 *     Organization.tier wire-up lands). Everyone else gets a silent downgrade
 *     to free, so the UI can still render a card without handling 402s on
 *     every click.
 */
@ApiTags('metros')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('metros')
export class MetrosController {
  constructor(private readonly metros: MetrosService) {}

  @Get()
  @ApiOperation({ summary: 'List active metros' })
  listMetros() {
    return this.metros.listMetros();
  }

  @Get(':code')
  @ApiOperation({ summary: 'Metro detail + coverage counts' })
  @ApiParam({ name: 'code', example: 'north-alabama' })
  getMetro(@Param('code') code: string) {
    return this.metros.getMetro(code);
  }

  @Get(':code/hexes')
  @ApiOperation({ summary: 'H3 hex aggregates (powers map heatmap)' })
  @ApiQuery({ name: 'res', enum: ['6', '7', '8', '9'], required: false, example: '6' })
  hexAggregates(@Param('code') code: string, @Query('res') res = '6') {
    return this.metros.hexAggregates(code, parseInt(res, 10));
  }

  @Get(':code/viewport')
  @ApiOperation({
    summary: 'Top-scored properties within a lat/lon bbox (zoom >= 13 pin layer)',
    description: 'Latency-first serve: live query against properties, no pin-card dependency. Used by the map when zoomed in enough that individual pins are renderable. At low zoom the client should use /hexes instead.',
  })
  @ApiQuery({ name: 'lonMin',  required: true,  example: -86.70 })
  @ApiQuery({ name: 'latMin',  required: true,  example: 34.65 })
  @ApiQuery({ name: 'lonMax',  required: true,  example: -86.55 })
  @ApiQuery({ name: 'latMax',  required: true,  example: 34.78 })
  @ApiQuery({ name: 'limit',   required: false, example: 100 })
  @ApiQuery({ name: 'dormantOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'minScore',    required: false })
  @ApiQuery({ name: 'yearBuiltMin', required: false, description: 'yearBuilt >= this' })
  @ApiQuery({ name: 'yearBuiltMax', required: false, description: 'yearBuilt <= this' })
  @ApiQuery({ name: 'minSpcHailCount5y',   required: false, description: 'SPC hail reports in last 5y >= this' })
  @ApiQuery({ name: 'minSpcHailMaxInches', required: false, description: 'SPC worst-ever hail >= this inches' })
  @ApiQuery({ name: 'minSpcTornadoCount',  required: false, description: 'SPC tornado reports >= this' })
  @ApiQuery({ name: 'minSpcSevereCount',   required: false, description: 'SPC severe-or-extreme reports >= this' })
  @ApiQuery({ name: 'hailSinceDays', required: false, description: 'spcHailLastDate within N days' })
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  viewport(
    @Param('code') code: string,
    @Query('lonMin')  lonMin: string,
    @Query('latMin')  latMin: string,
    @Query('lonMax')  lonMax: string,
    @Query('latMax')  latMax: string,
    @Query('limit')       limit?: string,
    @Query('dormantOnly') dormantOnly?: string,
    @Query('minScore')    minScore?: string,
    @Query('yearBuiltMin') yearBuiltMin?: string,
    @Query('yearBuiltMax') yearBuiltMax?: string,
    @Query('minSpcHailCount5y')   minSpcHailCount5y?: string,
    @Query('minSpcHailMaxInches') minSpcHailMaxInches?: string,
    @Query('minSpcTornadoCount')  minSpcTornadoCount?: string,
    @Query('minSpcSevereCount')   minSpcSevereCount?: string,
    @Query('hailSinceDays') hailSinceDays?: string,
  ) {
    return this.metros.viewport(code, {
      lonMin: parseFloat(lonMin),
      latMin: parseFloat(latMin),
      lonMax: parseFloat(lonMax),
      latMax: parseFloat(latMax),
      limit: limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500) : undefined,
      ...parseFilterOpts({
        dormantOnly, minScore, yearBuiltMin, yearBuiltMax,
        minSpcHailCount5y, minSpcHailMaxInches, minSpcTornadoCount,
        minSpcSevereCount, hailSinceDays,
      }),
    });
  }

  @Get(':code/top')
  @ApiOperation({ summary: 'Score-sorted top properties in this metro' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'minScore', required: false })
  @ApiQuery({ name: 'dormantOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'yearBuiltMin', required: false })
  @ApiQuery({ name: 'yearBuiltMax', required: false })
  @ApiQuery({ name: 'minSpcHailCount5y',   required: false })
  @ApiQuery({ name: 'minSpcHailMaxInches', required: false })
  @ApiQuery({ name: 'minSpcTornadoCount',  required: false })
  @ApiQuery({ name: 'minSpcSevereCount',   required: false })
  @ApiQuery({ name: 'hailSinceDays', required: false })
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  topProperties(
    @Param('code') code: string,
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
    @Query('dormantOnly') dormantOnly?: string,
    @Query('yearBuiltMin') yearBuiltMin?: string,
    @Query('yearBuiltMax') yearBuiltMax?: string,
    @Query('minSpcHailCount5y')   minSpcHailCount5y?: string,
    @Query('minSpcHailMaxInches') minSpcHailMaxInches?: string,
    @Query('minSpcTornadoCount')  minSpcTornadoCount?: string,
    @Query('minSpcSevereCount')   minSpcSevereCount?: string,
    @Query('hailSinceDays') hailSinceDays?: string,
  ) {
    return this.metros.topProperties(code, {
      limit: limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500) : undefined,
      ...parseFilterOpts({
        dormantOnly, minScore, yearBuiltMin, yearBuiltMax,
        minSpcHailCount5y, minSpcHailMaxInches, minSpcTornadoCount,
        minSpcSevereCount, hailSinceDays,
      }),
    });
  }

  @Get(':code/properties/:propertyId/pin')
  @ApiOperation({ summary: 'Denormalized pin-card for a property' })
  @ApiQuery({ name: 'tier', enum: ['free', 'pro'], required: false })
  pinCard(
    @Param('code') _code: string,
    @Param('propertyId') propertyId: string,
    @Query('tier') tier: string | undefined,
    @Req() req: Request,
  ) {
    const requested = tier === 'pro' ? 'pro' : 'free';
    const effective = resolveEffectiveTier(requested, req);
    return this.metros.pinCard(propertyId, effective, {
      requestedTier: requested,
      grantedTier: effective,
    });
  }
}

/**
 * Parse the query-string strings into typed FilterOpts. Centralized so
 * /viewport and /top stay in lockstep and the coercion rules live in one place.
 */
function parseFilterOpts(raw: {
  dormantOnly?: string; minScore?: string;
  yearBuiltMin?: string; yearBuiltMax?: string;
  minSpcHailCount5y?: string; minSpcHailMaxInches?: string;
  minSpcTornadoCount?: string; minSpcSevereCount?: string;
  hailSinceDays?: string;
}): FilterOpts {
  const n = (s?: string) => (s !== undefined && s !== '' ? parseFloat(s) : undefined);
  const i = (s?: string) => (s !== undefined && s !== '' ? parseInt(s, 10) : undefined);
  const out: FilterOpts = {
    dormantOnly: raw.dormantOnly === 'true',
    minScore:             n(raw.minScore),
    yearBuiltMin:         i(raw.yearBuiltMin),
    yearBuiltMax:         i(raw.yearBuiltMax),
    minSpcHailCount5y:    i(raw.minSpcHailCount5y),
    minSpcHailMaxInches:  n(raw.minSpcHailMaxInches),
    minSpcTornadoCount:   i(raw.minSpcTornadoCount),
    minSpcSevereCount:    i(raw.minSpcSevereCount),
  };
  const days = i(raw.hailSinceDays);
  if (days !== undefined && days > 0) {
    out.hailSince = new Date(Date.now() - days * 86400 * 1000);
  }
  return out;
}

/**
 * Resolve the tier we'll actually serve based on the user's entitlement.
 * ADMIN + SUPER_ADMIN get the pro payload. Everyone else falls back to free
 * (silent downgrade, not 402 — let the UI nudge upgrade instead of erroring).
 */
function resolveEffectiveTier(
  requested: 'free' | 'pro',
  req: Request,
): 'free' | 'pro' {
  if (requested === 'free') return 'free';
  const role = (req.user as { role?: string } | undefined)?.role;
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return 'pro';
  return 'free';
}
