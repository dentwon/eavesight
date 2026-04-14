import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { GetStormsDto } from './dto/get-storms.dto';

@Injectable()
export class StormsService {
  constructor(private readonly prisma: PrismaService) {}

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
  ) {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        FLOOR(lat / $1) * $1 AS cell_lat,
        FLOOR(lon / $1) * $1 AS cell_lon,
        COUNT(*)::int AS count
      FROM storm_events
      WHERE type IN ('HAIL', 'TORNADO')
        AND lat IS NOT NULL
        AND lon IS NOT NULL
        AND lat BETWEEN $2 AND $3
        AND lon BETWEEN $4 AND $5
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

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }

}
