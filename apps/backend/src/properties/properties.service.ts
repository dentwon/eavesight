import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { LookupPropertyDto } from './dto/lookup-property.dto';
import { ConfigService } from '@nestjs/config';
import { estimateRoofAge, roofAgeSuffix } from '../leads/roof-age.util';
import { RevealMeterService } from './reveal-meter.service';

interface RequestContext {
  orgId: string | null;
  userId: string | null;
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly revealMeter: RevealMeterService,
  ) {}

  async search(searchDto: SearchPropertiesDto) {
    const { state, city, zip, minYearBuilt, maxYearBuilt, lat, lon, radius, limit = 50 } = searchDto;

    const where: any = {};

    if (state) where.state = state;
    if (city) where.city = city;
    if (zip) where.zip = zip;

    if (minYearBuilt || maxYearBuilt) {
      where.yearBuilt = {};
      if (minYearBuilt) where.yearBuilt.gte = minYearBuilt;
      if (maxYearBuilt) where.yearBuilt.lte = maxYearBuilt;
    }

    if (lat && lon && radius) {
      where.lat = { gte: lat - radius, lte: lat + radius };
      where.lon = { gte: lon - radius, lte: lon + radius };
    }

    const properties = await this.prisma.property.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        propertyStorms: {
          include: { stormEvent: true },
        },
        roofData: true,
        buildingFootprint: true,
      },
    });

    // Derive roofAge + roofAgeSource from the canonical estimator so callers
    // (eg. the /dashboard/properties page) never have to do raw subtraction.
    return properties.map((p) => {
      const est = estimateRoofAge(p);
      return {
        ...p,
        roofAge: est.age,
        roofAgeSource: est.source,
      };
    });
  }

  /**
   * Get a single property. PII (owner phone/email/mailing address) is masked
   * by default and only included if the caller's org has revealed this
   * property in the current period (or has quota left to reveal it).
   *
   * `includePii=false` returns the masked record without consuming quota.
   * `includePii=true` checks-and-records a reveal — call this from the
   * "Reveal contact info" button click on the property panel, NOT from the
   * generic GET /properties/:id used to render score/year/storm history.
   */
  async findOne(id: string, ctx?: RequestContext, includePii: boolean = false) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        propertyStorms: { include: { stormEvent: true } },
        leads: ctx?.orgId ? { where: { orgId: ctx.orgId } } : false,
        roofData: true,
        buildingFootprint: true,
        enrichments: true,
      },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    if (!includePii || !ctx?.orgId || !ctx?.userId) {
      return this.revealMeter.maskPii(property);
    }

    const check = await this.revealMeter.checkReveal(ctx.orgId, id, 'reveal');
    if (!check.allowed) {
      throw new ForbiddenException(check.reason || 'Reveal quota exhausted');
    }
    if (!check.alreadyRevealed) {
      await this.revealMeter.recordReveal(ctx.orgId, ctx.userId, id, 'reveal');
    }
    return { ...property, ownerMasked: false };
  }


  async nearest(lat: number, lon: number) {
    // Small box prefilter (~1km) so we never scan the whole table, then
    // compute haversine distance in JS for the handful inside the box.
    const box = 0.015; // ~1.65km at 34N — plenty for a rep standing on a lawn
    const candidates = await this.prisma.property.findMany({
      where: {
        lat: { gte: lat - box, lte: lat + box },
        lon: { gte: lon - box, lte: lon + box },
      },
      select: {
        id: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        lat: true,
        lon: true,
        urgencyScore: true,
        opportunityScore: true,
        hailExposureIndex: true,
      },
      take: 200,
    });
    if (candidates.length === 0) return null;

    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    let best: any = null;
    let bestDist = Infinity;
    for (const p of candidates) {
      if (p.lat == null || p.lon == null) continue;
      const dLat = toRad(p.lat - lat);
      const dLon = toRad(p.lon - lon);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat)) * Math.cos(toRad(p.lat)) * Math.sin(dLon / 2) ** 2;
      const d = 2 * R * Math.asin(Math.sqrt(a));
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (!best) return null;
    // Only return a "match" if within 75m — otherwise the rep is between houses
    if (bestDist > 75) return { ...best, distanceM: Math.round(bestDist), matched: false };
    return { ...best, distanceM: Math.round(bestDist), matched: true };
  }


  async lookup(lookupDto: LookupPropertyDto) {
    const { address, city, state, zip } = lookupDto;

    let property = await this.prisma.property.findFirst({
      where: {
        address: { contains: address, mode: 'insensitive' },
        city,
        state,
        zip,
      },
      include: {
        propertyStorms: {
          include: { stormEvent: true },
        },
        roofData: true,
        buildingFootprint: true,
      },
    });

    if (!property) {
      // Fall back to MadisonParcelData. Whitelist fields explicitly — the
      // raw row contains owner names + mailing addresses we don't surface
      // outside the metered /reveal flow. Mirrors the masked field set
      // used by findInBounds.
      const parcel = await this.prisma.madisonParcelData.findFirst({
        where: {
          propertyAddress: { contains: address.toUpperCase() },
        },
        select: {
          // Identifiers + location only — owner names, mailing addresses,
          // deed history are NOT returned. Those live behind /reveal.
          pin: true,
          propertyAddress: true,
          zoning: true,
          floodZone: true,
          opportunityZone: true,
          acres: true,
          totalAppraisedValue: true,
          totalBuildingValue: true,
          lat: true,
          lon: true,
        },
      });
      if (parcel) {
        return {
          source: 'madison_parcel_data',
          ...parcel,
        };
      }
    }

    return property;
  }

  async getRoofData(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        roofData: true,
        buildingFootprint: true,
      },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    // Route through the canonical estimator -- same ladder used everywhere
    // else (measured > CoC > permit > yearBuilt mod-22 > unknown, cap 35).
    const est = estimateRoofAge(property);

    return {
      propertyId: property.id,
      address: property.address,
      roofData: property.roofData || null,
      buildingFootprint: property.buildingFootprint || null,
      estimatedAge: est.age,
      ageSource: est.source,
      ageSourceDetail: est.sourceDetail,
      ageDisplaySuffix: roofAgeSuffix(est.source),
      yearBuilt: property.yearBuilt,
      roofInstalledAt: property.roofInstalledAt,
      roofInstalledSource: property.roofInstalledSource,
      recommendations: this.getRoofRecommendations(est.age, est.source),
    };
  }

  private getRoofRecommendations(
    roofAge: number | null,
    source: 'measured' | 'coc' | 'permit' | 'inferred' | 'unknown' = 'unknown',
  ) {
    if (roofAge === null || source === 'unknown') {
      return 'No roof age data available. Consider scheduling an inspection.';
    }

    // For "inferred" ages (yearBuilt mod-22) the number is a modelled estimate,
    // not a measurement, so soften the language accordingly.
    const hedged = source === 'inferred';

    if (roofAge < 10) {
      return hedged
        ? 'Roof is likely in early life based on year built. Inspect to confirm.'
        : 'Roof appears relatively new. Likely no immediate replacement needed.';
    } else if (roofAge < 20) {
      return hedged
        ? 'Modeled estimate suggests mid-life roof. Inspection recommended to verify.'
        : 'Roof is approaching mid-life. Monitor for signs of wear.';
    } else if (roofAge < 25) {
      return hedged
        ? 'Modeled estimate suggests end-of-life roof. Inspection strongly recommended.'
        : 'Roof is at typical lifespan end. Consider inspection and replacement.';
    } else {
      return hedged
        ? 'Modeled estimate suggests past lifespan. Inspection recommended before outreach.'
        : 'Roof is past typical lifespan. Replacement likely needed.';
    }
  }

  // Bulk viewport endpoint — NEVER returns owner PII (phone/email/mailing
  // address). Reveal-meter requires per-property opt-in via findOne(includePii=true).
  async getPropertiesInBounds(
    north: number,
    south: number,
    east: number,
    west: number,
    limit: number = 500,
  ) {
    const properties = await this.prisma.property.findMany({
      where: {
        lat: { gte: south, lte: north },
        lon: { gte: west, lte: east },
      },
      take: limit,
      select: {
        id: true,
        lat: true,
        lon: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        assessedValue: true,
        marketValue: true,
        yearBuilt: true,
        propertyType: true,
        onDncList: true,
        roofData: {
          select: {
            totalAreaSqft: true,
            material: true,
            condition: true,
            estimatedTotalCost: true,
          },
        },
        buildingFootprint: {
          select: {
            geometry: true,
            areaSqft: true,
          },
        },
      },
    });

    return properties;
  }

  // Viewport endpoint for the map. Returns NO owner-contact PII; reveal is
  // a separate metered call via findOne(includePii=true).
  async findInBounds(north: number, south: number, east: number, west: number, limit: number = 5000, includeGeometry: boolean = false) {
    // Try Property table first (has lat/lon), fall back to MadisonParcelData
    const propertyCount = await this.prisma.property.count();
    if (propertyCount > 0) {
      return this.prisma.property.findMany({
        where: {
          lat: { gte: south, lte: north },
          lon: { gte: west, lte: east },
        },
        take: limit,
        select: {
          id: true,
          lat: true,
          lon: true,
          address: true,
          assessedValue: true,
          marketValue: true,
          yearBuilt: true,
          buildingFootprint: includeGeometry ? {
            select: { geometry: true, areaSqft: true },
          } : {
            select: { areaSqft: true },
          },
          roofData: {
            select: { totalAreaSqft: true, material: true, condition: true, estimatedTotalCost: true },
          },
        },
      });
    }

    // Fall back to MadisonParcelData (no lat/lon but has address search).
    // ownerName intentionally NOT returned in the bulk path.
    const parcels = await this.prisma.madisonParcelData.findMany({
      take: limit,
      orderBy: { pin: 'asc' },
    });

    return parcels.map(p => ({
      id: p.pin,
      pin: p.pin,
      lat: null,
      lon: null,
      address: p.propertyAddress,
      // totalAppraisedValue is the real market value; totalAssessedValue is 10% of that for tax purposes.
      assessedValue: p.totalAssessedValue,
      marketValue: p.totalAppraisedValue,
    }));
  }

}
