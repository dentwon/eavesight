import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { GetStormsDto } from './dto/get-storms.dto';
import { StormEvent, Prisma } from '@prisma/client';

type StormWithRelations = StormEvent & {
  propertyStorms?: (Prisma.PropertyStormGetPayload<{ include: { property: true } }> & { property: any })[];
  _count?: { propertyStorms: number };
};

@Injectable()
export class StormsService {
  constructor(private readonly prisma: PrismaService) {}

  // Transform StormEvent to include lat/lon from geom for frontend
  private transformStorm(storm: StormWithRelations) {
    const geom = storm.geom as { lat?: number; lon?: number } | null;
    return {
      ...storm,
      lat: geom?.lat ?? null,
      lon: geom?.lon ?? null,
    };
  }

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
      data: storms.map((s: StormWithRelations) => this.transformStorm(s)),
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

    return this.transformStorm(storm as StormWithRelations);
  }

  async findActive() {
    // Active storms: in the last 7 days
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

    return storms.map((s: StormWithRelations) => this.transformStorm(s));
  }

  async findNearby(lat: number, lon: number, radiusKm: number = 50) {
    // Simplified: find storms in same state/county
    // For production, use PostGIS ST_DWithin
    const storms = await this.prisma.stormEvent.findMany({
      where: {
        date: {
          gte: new Date(new Date().setFullYear(new Date().getFullYear() - 2)),
        },
      },
      orderBy: { date: 'desc' },
      take: 50,
    });

    return storms.map((s: StormWithRelations) => this.transformStorm(s));
  }

  async getStormZones(state: string, limit: number = 100) {
    // Get aggregated storm data by county for map visualization
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
  }) {
    // Check if this storm already exists
    const existing = await this.prisma.stormEvent.findFirst({
      where: {
        sourceId: data.sourceId,
        source: data.source,
        date: data.date,
      },
    });

    if (existing) {
      return this.transformStorm(existing as StormWithRelations);
    }

    const storm = await this.prisma.stormEvent.create({
      data: {
        type: data.type as any,
        severity: data.severity as any,
        date: data.date,
        city: data.city,
        county: data.county,
        state: data.state,
        description: data.description,
        source: data.source,
        sourceId: data.sourceId,
        geom: data.lat && data.lon ? { lat: data.lat, lon: data.lon } : undefined,
      },
    });

    return this.transformStorm(storm as StormWithRelations);
  }
}
