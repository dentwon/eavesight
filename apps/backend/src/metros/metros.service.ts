import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * MetrosService — read-path for the scale-ready pipeline.
 *
 *   listMetros()                 — active markets the UI can show
 *   getMetro(code)               — metro detail + coverage counts
 *   hexAggregates(code, res)     — pre-computed H3 rollups (map tile power)
 *   pinCard(propertyId, tier)    — denormalized pin-click payload
 *   topProperties(code, opts)    — score-sorted list within metro
 *   viewport(code, opts)         — in-bbox pin layer, zoom >= 13
 *
 * Every read here is single-table, index-backed, no PostGIS joins at
 * request time. Aggregates are rebuilt nightly by the pipeline, not on-demand.
 */
@Injectable()
export class MetrosService {
  constructor(private readonly prisma: PrismaService) {}

  async listMetros() {
    return this.prisma.metro.findMany({
      where: { status: 'active' },
      orderBy: { launchedAt: 'asc' },
      select: {
        code: true,
        name: true,
        stateCodes: true,
        centerLat: true,
        centerLon: true,
        bboxMinLat: true,
        bboxMaxLat: true,
        bboxMinLon: true,
        bboxMaxLon: true,
        defaultZoom: true,
        tier: true,
        launchedAt: true,
      },
    });
  }

  async getMetro(code: string) {
    const metro = await this.prisma.metro.findUnique({ where: { code } });
    if (!metro) throw new NotFoundException(`Metro '${code}' not found`);

    const [propertyCount, pinCount, dormantCount, scoredCount] = await Promise.all([
      this.prisma.property.count({ where: { metroCode: code } }),
      this.prisma.propertyPinCard.count({ where: { metroCode: code } }),
      this.prisma.propertyPinCard.count({ where: { metroCode: code, dormantFlag: true } }),
      this.prisma.property.count({ where: { metroCode: code, score: { not: null } } }),
    ]);

    return {
      ...metro,
      coverage: { propertyCount, pinCount, dormantCount, scoredCount },
    };
  }

  async hexAggregates(code: string, resolution: number) {
    if (![6, 7, 8, 9].includes(resolution)) {
      return { metroCode: code, resolution, features: [] };
    }
    const rows = await this.prisma.propertyHexAggregate.findMany({
      where: { metroCode: code, resolution },
      select: {
        h3Cell: true,
        n: true,
        scoreP50: true,
        scoreP90: true,
        scoreMax: true,
        dormantCount: true,
        hailMaxInches: true,
        avgRoofAge: true,
        centerLat: true,
        centerLon: true,
      },
    });
    return { metroCode: code, resolution, count: rows.length, features: rows };
  }

  /**
   * Returns the denormalized pin-card for a property. The entitlement decision
   * lives in the controller (role-based today, Stripe-backed later); this
   * service just serves what it's asked for and echoes what tier was granted
   * vs requested so the UI can show an "upgrade" nudge if they don't match.
   */
  async pinCard(
    propertyId: string,
    tier: 'free' | 'pro' = 'free',
    meta?: { requestedTier: 'free' | 'pro'; grantedTier: 'free' | 'pro' },
  ) {
    const card = await this.prisma.propertyPinCard.findUnique({
      where: { propertyId },
    });
    if (!card) throw new NotFoundException(`No pin-card for property '${propertyId}'`);

    const payload = tier === 'pro' ? card.payloadPro : card.payloadFree;

    return {
      propertyId,
      metroCode: card.metroCode,
      score: card.score,
      dormantFlag: card.dormantFlag,
      payload,
      updatedAt: card.updatedAt,
      entitlement: meta ?? { requestedTier: tier, grantedTier: tier },
    };
  }

  /**
   * Shared filter builder — both /viewport and /top compose the same WHERE
   * slice, so score/SPC/yearBuilt thresholds behave identically across the
   * map pin layer and the top-list sidebar.
   */
  private buildFilterWhere(opts: FilterOpts) {
    const where: any = {};
    if (opts.minScore !== undefined)
      where.score = { gte: opts.minScore };
    if (opts.dormantOnly)
      where.dormantFlag = true;

    if (opts.yearBuiltMin !== undefined || opts.yearBuiltMax !== undefined) {
      where.yearBuilt = {};
      if (opts.yearBuiltMin !== undefined) where.yearBuilt.gte = opts.yearBuiltMin;
      if (opts.yearBuiltMax !== undefined) where.yearBuilt.lte = opts.yearBuiltMax;
    }

    if (opts.minSpcHailCount5y !== undefined)
      where.spcHailCount5y = { gte: opts.minSpcHailCount5y };
    if (opts.minSpcHailMaxInches !== undefined)
      where.spcHailMaxInches = { gte: opts.minSpcHailMaxInches };
    if (opts.minSpcTornadoCount !== undefined)
      where.spcTornadoCount = { gte: opts.minSpcTornadoCount };
    if (opts.minSpcSevereCount !== undefined)
      where.spcSevereOrExtremeCount = { gte: opts.minSpcSevereCount };
    if (opts.hailSince) {
      where.spcHailLastDate = { gte: opts.hailSince };
    }
    return where;
  }

  async topProperties(
    code: string,
    opts: { limit?: number } & FilterOpts,
  ) {
    const limit = Math.min(opts.limit ?? 50, 500);

    const usesExtendedFilters =
      opts.yearBuiltMin !== undefined ||
      opts.yearBuiltMax !== undefined ||
      opts.minSpcHailCount5y !== undefined ||
      opts.minSpcHailMaxInches !== undefined ||
      opts.minSpcTornadoCount !== undefined ||
      opts.minSpcSevereCount !== undefined ||
      opts.hailSince !== undefined;

    // Fast-path: only score/dormant filters — read pin_cards directly.
    if (!usesExtendedFilters) {
      return this.prisma.propertyPinCard.findMany({
        where: {
          metroCode: code,
          ...(opts.minScore !== undefined ? { score: { gte: opts.minScore } } : {}),
          ...(opts.dormantOnly ? { dormantFlag: true } : {}),
        },
        orderBy: { score: 'desc' },
        take: limit,
        select: {
          propertyId: true,
          score: true,
          dormantFlag: true,
          payloadFree: true,
          updatedAt: true,
        },
      });
    }

    // Extended-filter path: filter from properties (has SPC cols), hydrate with pin payload.
    const propertyWhere: any = { metroCode: code, ...this.buildFilterWhere(opts) };
    const props = await this.prisma.property.findMany({
      where: propertyWhere,
      orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    if (props.length === 0) return [];
    const ids = props.map((p) => p.id);
    const cards = await this.prisma.propertyPinCard.findMany({
      where: { propertyId: { in: ids } },
      select: {
        propertyId: true,
        score: true,
        dormantFlag: true,
        payloadFree: true,
        updatedAt: true,
      },
    });
    const byId = new Map(cards.map((c) => [c.propertyId, c]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  /**
   * Viewport query — latency-first serving for zoom >= 13.
   *
   * Indexes we rely on (migration 20260420120000_viewport_indexes):
   *   properties (metroCode, lat, lon)                 partial
   *   properties (metroCode, score DESC)               partial dormant
   *   properties (metroCode, lat, lon)                 partial dormant
   */
  async viewport(
    code: string,
    opts: {
      lonMin: number; latMin: number; lonMax: number; latMax: number;
      limit?: number;
    } & FilterOpts,
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 100000, 1), 100000);
    const { lonMin, latMin, lonMax, latMax } = opts;

    if (latMin > latMax || lonMin > lonMax) {
      return { metroCode: code, bbox: opts, count: 0, limit, features: [] };
    }

    const rows = await this.prisma.property.findMany({
      where: {
        metroCode: code,
        lat: { gte: latMin, lte: latMax, not: null },
        lon: { gte: lonMin, lte: lonMax, not: null },
        ...this.buildFilterWhere(opts),
      },
      orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        lat: true,
        lon: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        score: true,
        dormantFlag: true,
        yearBuilt: true,
        scoreReasons: true,
        hailExposureIndex: true,
        spcHailCount5y: true,
        spcHailMaxInches: true,
        spcHailLastDate: true,
        spcTornadoCount: true,
        spcSevereOrExtremeCount: true,
      },
    });

    return {
      metroCode: code,
      bbox: { lonMin, latMin, lonMax, latMax },
      count: rows.length,
      limit,
      features: rows,
    };
  }
}

/**
 * Shared filter knobs accepted by /metros/:code/viewport and /top.
 * Every field is optional; omit to skip that filter.
 */
export interface FilterOpts {
  dormantOnly?: boolean;
  minScore?: number;
  yearBuiltMin?: number;
  yearBuiltMax?: number;
  minSpcHailCount5y?: number;
  minSpcHailMaxInches?: number;
  minSpcTornadoCount?: number;
  minSpcSevereCount?: number;
  /** spcHailLastDate >= this Date (e.g. 3-year or 5-year storm-recency cutoff) */
  hailSince?: Date;
}
