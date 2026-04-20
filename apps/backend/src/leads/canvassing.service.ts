import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class CanvassingService {
  private readonly logger = new Logger(CanvassingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateList(params: {
    orgId: string;
    stormId?: string;
    lat?: number;
    lon?: number;
    radiusKm?: number;
    limit?: number;
    minScore?: number;
    status?: string;
  }): Promise<{
    list: CanvassingItem[];
    meta: {
      total: number;
      stormInfo: any;
      generatedAt: string;
    };
  }> {
    const { orgId, stormId, lat, lon, radiusKm = 15, limit = 50, minScore = 0, status } = params;

    let centerLat = lat;
    let centerLon = lon;
    let stormInfo: any = null;

    if (stormId) {
      const storm = await this.prisma.stormEvent.findUnique({ where: { id: stormId } });
      if (storm) {
        centerLat = storm.lat ?? undefined;
        centerLon = storm.lon ?? undefined;
        stormInfo = {
          id: storm.id,
          type: storm.type,
          severity: storm.severity,
          date: storm.date,
          city: storm.city,
          county: storm.county,
        };
      }
    }

    if (!centerLat || !centerLon) {
      return { list: [], meta: { total: 0, stormInfo, generatedAt: new Date().toISOString() } };
    }

    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / 85;

    const whereClause: any = {
      orgId,
      score: { gte: minScore },
      property: {
        lat: { gte: centerLat - latDelta, lte: centerLat + latDelta },
        lon: { gte: centerLon - lonDelta, lte: centerLon + lonDelta },
      },
    };

    if (status) {
      whereClause.status = status;
    }

    const leads = await this.prisma.lead.findMany({
      where: whereClause,
      include: {
        property: {
          include: {
            enrichments: true,
            roofData: true,
            propertyStorms: {
              where: stormId ? { stormEventId: stormId } : {},
              include: { stormEvent: true },
              take: 3,
            },
          },
        },
        assignee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: [
        { score: 'desc' },
        { priority: 'desc' },
      ],
      take: limit,
    });

    const items: CanvassingItem[] = leads
      .filter(lead => lead.property?.lat && lead.property?.lon)
      .map((lead, index) => {
        const property = lead.property!;
        const enrichments = property.enrichments;
        const roofData = property.roofData;
        const distance = this.haversineDistance(
          centerLat!, centerLon!,
          property.lat!, property.lon!,
        );

        let roofAge: number | null = roofData?.age ?? null;
        if (!roofAge && property.yearBuilt) {
          roofAge = new Date().getFullYear() - property.yearBuilt;
        }

        return {
          order: index + 1,
          leadId: lead.id,
          score: lead.score,
          priority: lead.priority,
          status: lead.status,

          firstName: lead.firstName || property.ownerFirstName,
          lastName: lead.lastName || property.ownerLastName,
          phone: lead.phone || property.ownerPhone,
          email: lead.email || property.ownerEmail,
          onDncList: property.onDncList,

          address: property.address,
          city: property.city,
          state: property.state,
          zip: property.zip,
          lat: property.lat,
          lon: property.lon,

          yearBuilt: property.yearBuilt,
          roofAge,
          roofMaterial: roofData?.material || null,
          estimatedRoofSqft: roofData?.totalAreaSqft || null,
          estimatedJobValue: roofData?.estimatedTotalCost || null,
          assessedValue: property.assessedValue,
          marketValue: property.marketValue,

          medianHomeValue: enrichments?.medianHomeValue || null,
          homeownershipRate: enrichments?.homeownershipRate || null,
          ownerName: property.ownerFullName,

          distanceFromStormKm: Math.round(distance / 100) / 10,
          stormSeverity: property.propertyStorms?.[0]?.stormEvent?.severity || null,

          assignee: lead.assignee
            ? `${lead.assignee.firstName || ''} ${lead.assignee.lastName || ''}`.trim()
            : null,

          notes: lead.notes,
        };
      });

    items.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.distanceFromStormKm - b.distanceFromStormKm;
    });

    items.forEach((item, i) => { item.order = i + 1; });

    return {
      list: items,
      meta: {
        total: items.length,
        stormInfo,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export interface CanvassingItem {
  order: number;
  leadId: string;
  score: number;
  priority: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  onDncList: boolean;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lon: number | null;
  yearBuilt: number | null;
  roofAge: number | null;
  roofMaterial: string | null;
  estimatedRoofSqft: number | null;
  estimatedJobValue: number | null;
  assessedValue: number | null;
  marketValue: number | null;
  medianHomeValue: number | null;
  homeownershipRate: number | null;
  ownerName: string | null;
  distanceFromStormKm: number;
  stormSeverity: string | null;
  assignee: string | null;
  notes: string | null;
}
