import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { GetStormsDto } from './dto/get-storms.dto';
import { TtlCache, bboxKey } from '../common/ttl-cache';

@Injectable()
export class StormsService {
  constructor(private readonly prisma: PrismaService) {}

  // 60s cache, 64 viewports. Keyed by bbox+window, both endpoints share it.
  private readonly heatmapCache = new TtlCache<string, any>(64, 60_000);
  private readonly tracksCache = new TtlCache<string, any>(64, 60_000);

  async findAll(query: GetStormsDto) {
    const {
      state,
      county,
      city,
      type,
      severity,
      startDate,
      endDate,
      limit = 100,
      offset = 0,
    } = query;

    const where: any = {};

    if (state) where.state = state;
    if (county) where.county = county;
    if (city) where.city = city;
    if (type) where.type = type;
    if (severity) where.severity = severity;

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [storms, total] = await Promise.all([
      this.prisma.stormEvent.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { date: 'desc' },
        include: {
          propertyStorms: {
            include: { property: true },
            take: 10,
          },
        },
      }),
      this.prisma.stormEvent.count({ where }),
    ]);

    return {
      data: storms,
      meta: {
        total,
        limit,
        offset,
        hasMore: offset + storms.length < total,
      },
    };
  }

  async findOne(id: string) {
    const storm = await this.prisma.stormEvent.findUnique({
      where: { id },
      include: {
        propertyStorms: {
          include: { property: true },
        },
      },
    });

    if (!storm) {
      throw new NotFoundException('Storm event not found');
    }

    return storm;
  }

  async findActive() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const storms = await this.prisma.stormEvent.findMany({
      where: {
        date: { gte: sevenDaysAgo },
      },
      orderBy: { date: 'desc' },
      include: {
        _count: {
          select: { propertyStorms: true },
        },
      },
    });

    return storms;
  }

  async findNearby(lat: number, lon: number, radiusKm: number = 50) {
    // Approximate bounding box filter (1 degree ~ 111km)
    const degreeRadius = radiusKm / 111;

    const storms = await this.prisma.stormEvent.findMany({
      where: {
        lat: { gte: lat - degreeRadius, lte: lat + degreeRadius },
        lon: { gte: lon - degreeRadius, lte: lon + degreeRadius },
        date: {
          gte: new Date(new Date().setFullYear(new Date().getFullYear() - 2)),
        },
      },
      orderBy: { date: 'desc' },
      take: 50,
    });

    return storms;
  }

  async getStormZones(state: string, limit: number = 100) {
    const storms = await this.prisma.stormEvent.groupBy({
      by: ['county', 'state', 'type', 'severity'],
      where: { state },
      _count: { id: true },
      orderBy: {
        _count: { id: 'desc' },
      },
      take: limit,
    });

    return storms.map((s: any) => ({
      county: s.county,
      state: s.state,
      type: s.type,
      severity: s.severity,
      count: s._count.id,
    }));
  }

  async syncFromNOAA(data: {
    type: string;
    severity?: string;
    date: Date;
    city?: string;
    county?: string;
    state: string;
    description?: string;
    source?: string;
    sourceId?: string;
    lat?: number;
    lon?: number;
    hailSizeInches?: number;
    windSpeedMph?: number;
    tornadoFScale?: string;
  }) {
    const existing = await this.prisma.stormEvent.findFirst({
      where: {
        sourceId: data.sourceId,
        source: data.source,
        date: data.date,
      },
    });

    if (existing) return existing;

    const storm = await this.prisma.stormEvent.create({
      data: {
        type: data.type as any,
        severity: data.severity as any,
        date: data.date,
        city: data.city,
        county: data.county,
        state: data.state,
        lat: data.lat,
        lon: data.lon,
        hailSizeInches: data.hailSizeInches,
        windSpeedMph: data.windSpeedMph,
        tornadoFScale: data.tornadoFScale,
        description: data.description,
        source: data.source,
        sourceId: data.sourceId,
      },
    });

    return storm;
  }

  async getHailFrequencyGrid(
    north: number,
    south: number,
    east: number,
    west: number,
    gridSize: number = 0.05,
    months: number = 24,
  ) {
    const monthsInt = Math.max(1, Math.min(600, Math.floor(months)));
    const cacheKey = `${bboxKey(north, south, east, west, 0.05)}|g=${gridSize}|m=${monthsInt}`;
    const hit = this.heatmapCache.get(cacheKey);
    if (hit) return hit;

    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        FLOOR(lat / $1) * $1 AS cell_lat,
        FLOOR(lon / $1) * $1 AS cell_lon,
        COUNT(*)::int AS count
      FROM storm_events
      WHERE type::text IN ('HAIL', 'TORNADO')
        AND lat IS NOT NULL
        AND lon IS NOT NULL
        AND lat BETWEEN $2 AND $3
        AND lon BETWEEN $4 AND $5
        AND date >= NOW() - INTERVAL '${monthsInt} months'
      GROUP BY cell_lat, cell_lon
      `,
      gridSize,
      south,
      north,
      west,
      east,
    );

    const maxCount = rows.length > 0 ? Math.max(...rows.map((r) => r.count)) : 1;

    const features = rows.map((row) => {
      const s = Number(row.cell_lat);
      const w = Number(row.cell_lon);
      const n = s + gridSize;
      const e = w + gridSize;

      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
        properties: {
          count: row.count,
          normalized: row.count / maxCount,
          cellLat: s,
          cellLon: w,
        },
      };
    });

    const fc = {
      type: 'FeatureCollection' as const,
      features,
    };
    this.heatmapCache.set(cacheKey, fc);
    return fc;
  }

  /**
   * Storm trajectories as GeoJSON. Uses the start→end points that 78% of
   * NOAA storm events already have, so tornadoes/hail/wind render as actual
   * paths — not as synthetic axis-aligned grid cells.
   *
   * Events with no endpoint fall back to Points (the existing storm-dots
   * layer already handles those — we omit them here to keep this response
   * focused on trajectories).
   */
  async getStormTracks(
    north: number,
    south: number,
    east: number,
    west: number,
    months: number = 24,
    types: string[] = ['HAIL', 'TORNADO', 'WIND'],
  ) {
    // Sanitize types to a strict allowlist before inlining (prevents SQL injection).
    const ALLOWED = new Set(['HAIL', 'TORNADO', 'WIND', 'TSTM', 'FLOOD', 'HURRICANE', 'OTHER']);
    const cleanTypes = types
      .map(t => t.toUpperCase())
      .filter(t => ALLOWED.has(t));
    if (cleanTypes.length === 0) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    const typeList = cleanTypes.map(t => `'${t}'`).join(',');
    const monthsInt = Math.max(1, Math.min(600, Math.floor(months)));

    const cacheKey = `${bboxKey(north, south, east, west, 0.02)}|m=${monthsInt}|t=${cleanTypes.sort().join(',')}`;
    const hit = this.tracksCache.get(cacheKey);
    if (hit) return hit;

    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        id, type::text AS type, severity::text AS severity, date,
        lat, lon, "endLat", "endLon",
        "widthYards", "lengthMiles",
        "hailSizeInches", "windSpeedMph", "tornadoFScale"
      FROM storm_events
      WHERE type::text IN (${typeList})
        AND lat IS NOT NULL AND lon IS NOT NULL
        AND "endLat" IS NOT NULL AND "endLon" IS NOT NULL
        AND lat BETWEEN $1 AND $2
        AND lon BETWEEN $3 AND $4
        AND date >= NOW() - INTERVAL '${monthsInt} months'
      ORDER BY date DESC
      LIMIT 5000
      `,
      south,
      north,
      west,
      east,
    );

    const features = rows.map((r) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [Number(r.lon), Number(r.lat)],
          [Number(r.endLon), Number(r.endLat)],
        ],
      },
      properties: {
        id: r.id,
        type: r.type,
        severity: r.severity || 'MODERATE',
        date: r.date,
        // For tornadoes, widthYards lets the frontend size the line/swath
        widthYards: r.widthYards ? Number(r.widthYards) : null,
        lengthMiles: r.lengthMiles ? Number(r.lengthMiles) : null,
        hailSizeInches: r.hailSizeInches ? Number(r.hailSizeInches) : null,
        windSpeedMph: r.windSpeedMph ? Number(r.windSpeedMph) : null,
        tornadoFScale: r.tornadoFScale || null,
      },
    }));

    const fc = {
      type: 'FeatureCollection' as const,
      features,
    };
    this.tracksCache.set(cacheKey, fc);
    return fc;
  }

  /**
   * Storm damage footprints — the "dead-accurate + aesthetically rich" renderer.
   *
   * Returns three geometry roles per event:
   *   - 'swath'      Polygon: true ground-truth damage footprint
   *                  (tornado widthYards buffered; hail approximation flagged)
   *   - 'centerline' LineString: NWS-reported path (for the crisp keyline layer)
   *   - 'point'      Point: fallback for events with no endpoint
   *
   * Plus 'aura' (the blurred underlay) which is the same geometry as 'swath' —
   * the frontend just renders it twice with different paint.
   *
   * All buffers computed in PostGIS geography (meters) and cast back to
   * geometry for GeoJSON output — correct on WGS84 globe.
   */
  private readonly swathsCache = new TtlCache<string, any>(64, 60_000);

  async getStormSwaths(
    north: number,
    south: number,
    east: number,
    west: number,
    months: number = 24,
    types: string[] = ['HAIL', 'TORNADO', 'WIND'],
  ) {
    const ALLOWED = new Set(['HAIL', 'TORNADO', 'WIND', 'TSTM', 'FLOOD', 'HURRICANE', 'OTHER']);
    const cleanTypes = types.map(t => t.toUpperCase()).filter(t => ALLOWED.has(t));
    if (cleanTypes.length === 0) return { type: 'FeatureCollection' as const, features: [] };
    const typeList = cleanTypes.map(t => `'${t}'`).join(',');
    const monthsInt = Math.max(1, Math.min(600, Math.floor(months)));

    const cacheKey = `swaths|${bboxKey(north, south, east, west, 0.02)}|m=${monthsInt}|t=${cleanTypes.sort().join(',')}`;
    const hit = this.swathsCache.get(cacheKey);
    if (hit) return hit;

    // Single PostGIS query returns everything in a FeatureCollection with a
    // discriminant column 'role' so the frontend can filter-layer without
    // doing geometry inspection itself.
    //
    // Width rules:
    //   TORNADO: widthYards is NWS-measured → exact buffer
    //   HAIL:    no measured swath width exists — we synthesize a width from
    //            hailSizeInches (NWS climatology: ~1 mi wide per 1" hail,
    //            clipped 0.5-5 mi). FLAGGED with approxWidth=true so the UI
    //            can render differently / label honestly.
    //   WIND:    straight-line wind reports, no width → no polygon,
    //            only arrow (centerline + properties.arrow = true)
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      WITH base AS (
        SELECT
          id::text AS id,
          type::text AS type,
          severity::text AS severity,
          date,
          lat, lon, "endLat", "endLon",
          "widthYards", "lengthMiles",
          "hailSizeInches", "windSpeedMph", "tornadoFScale",
          CASE
            WHEN "endLat" IS NOT NULL AND "endLon" IS NOT NULL THEN
              ST_SetSRID(ST_MakeLine(
                ST_MakePoint(lon, lat),
                ST_MakePoint("endLon", "endLat")
              ), 4326)::geography
            ELSE NULL
          END AS line_geog
        FROM storm_events
        WHERE type::text IN (${typeList})
          AND lat IS NOT NULL AND lon IS NOT NULL
          AND lat BETWEEN $1 AND $2
          AND lon BETWEEN $3 AND $4
          AND date >= NOW() - INTERVAL '${monthsInt} months'
        ORDER BY date DESC
        LIMIT 8000
      )
      SELECT
        id, type, severity, date,
        lat, lon, "endLat", "endLon",
        "widthYards", "lengthMiles", "hailSizeInches", "windSpeedMph", "tornadoFScale",
        -- swath polygon (null if we can't build one)
        CASE
          WHEN type = 'TORNADO' AND line_geog IS NOT NULL AND "widthYards" IS NOT NULL AND "widthYards" > 0
            THEN ST_AsGeoJSON(ST_Buffer(line_geog, GREATEST("widthYards" * 0.9144 / 2.0, 30))::geometry)::json
          WHEN type = 'HAIL' AND line_geog IS NOT NULL AND "hailSizeInches" IS NOT NULL
            THEN ST_AsGeoJSON(ST_Buffer(line_geog, LEAST(GREATEST("hailSizeInches" * 800, 400), 8000))::geometry)::json
          ELSE NULL
        END AS swath_geojson,
        -- centerline (always when both points exist)
        CASE
          WHEN line_geog IS NOT NULL
            THEN ST_AsGeoJSON(line_geog::geometry)::json
          ELSE NULL
        END AS line_geojson,
        -- half-width in meters for frontend arrow/taper calc
        CASE
          WHEN type = 'TORNADO' AND "widthYards" IS NOT NULL THEN "widthYards" * 0.9144 / 2.0
          WHEN type = 'HAIL' AND "hailSizeInches" IS NOT NULL THEN LEAST(GREATEST("hailSizeInches" * 800, 400), 8000)
          ELSE NULL
        END AS half_width_m,
        -- swath width is synthesized (hail) vs measured (tornado)
        (type = 'HAIL') AS approx_width
      FROM base
      `,
      south, north, west, east,
    );

    const features: any[] = [];
    for (const r of rows) {
      const baseProps = {
        id: r.id,
        type: r.type,
        severity: r.severity || 'MODERATE',
        date: r.date,
        widthYards: r.widthYards !== null ? Number(r.widthYards) : null,
        lengthMiles: r.lengthMiles !== null ? Number(r.lengthMiles) : null,
        hailSizeInches: r.hailSizeInches !== null ? Number(r.hailSizeInches) : null,
        windSpeedMph: r.windSpeedMph !== null ? Number(r.windSpeedMph) : null,
        tornadoFScale: r.tornadoFScale || null,
        halfWidthM: r.half_width_m !== null ? Number(r.half_width_m) : null,
        approxWidth: !!r.approx_width,
        // magnitude 0..1 for opacity/radius ramps, per-type
        magnitude:
          r.type === 'TORNADO' ? this.efToMag(r.tornadoFScale) :
          r.type === 'HAIL'    ? Math.min(1, (Number(r.hailSizeInches) || 0) / 3) :
          r.type === 'WIND'    ? Math.min(1, (Number(r.windSpeedMph) || 0) / 100) :
          0.3,
      };

      // 1) Swath polygon (tornadoes + approximated hail)
      if (r.swath_geojson) {
        features.push({
          type: 'Feature' as const,
          geometry: r.swath_geojson,
          properties: { ...baseProps, role: 'swath' },
        });
      }

      // 2) Centerline (always when line geometry exists — crisp keyline layer)
      if (r.line_geojson) {
        features.push({
          type: 'Feature' as const,
          geometry: r.line_geojson,
          properties: { ...baseProps, role: 'centerline' },
        });
      } else {
        // 3) Fallback point (no endpoint → single reported location)
        features.push({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [Number(r.lon), Number(r.lat)],
          },
          properties: { ...baseProps, role: 'point' },
        });
      }
    }

    const fc = { type: 'FeatureCollection' as const, features };
    this.swathsCache.set(cacheKey, fc);
    return fc;
  }

  private efToMag(ef: string | null): number {
    if (!ef) return 0.2;
    const n = Number(String(ef).replace(/[^0-9]/g, ''));
    if (isNaN(n)) return 0.2;
    return Math.min(1, n / 5); // EF0=0, EF5=1
  }

}
