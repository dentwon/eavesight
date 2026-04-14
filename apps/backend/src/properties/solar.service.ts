import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import axios from 'axios';

interface RoofSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  stats: {
    areaMeters2: number;
    sunshineQuantiles: number[];
    groundAreaMeters2: number;
  };
  center: { latitude: number; longitude: number };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  planeHeightAtCenterMeters: number;
}

interface SolarInsights {
  name: string;
  center: { latitude: number; longitude: number };
  regionCode: string;
  solarPotential: {
    maxArrayPanelsCount: number;
    maxArrayAreaMeters2: number;
    maxSunshineHoursPerYear: number;
    carbonOffsetFactorKgPerMwh: number;
    wholeRoofStats: {
      areaMeters2: number;
      sunshineQuantiles: number[];
      groundAreaMeters2: number;
    };
    roofSegmentStats: RoofSegment[];
    buildingStats: {
      areaMeters2: number;
      sunshineQuantiles: number[];
      groundAreaMeters2: number;
    };
  };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  imageryDate: { year: number; month: number; day: number };
  imageryProcessedDate: { year: number; month: number; day: number };
  imageryQuality: string;
}

@Injectable()
export class SolarService {
  private readonly logger = new Logger(SolarService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://solar.googleapis.com/v1';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiKey = this.configService.get<string>('GOOGLE_SOLAR_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_SOLAR_API_KEY not set — Solar API calls will be skipped');
    }
  }

  async getBuildingInsights(lat: number, lon: number): Promise<SolarInsights | null> {
    if (!this.apiKey) {
      this.logger.warn('Solar API key not configured');
      return null;
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/buildingInsights:findClosest`,
        {
          params: {
            'location.latitude': lat,
            'location.longitude': lon,
            requiredQuality: 'LOW',
            key: this.apiKey,
          },
          timeout: 10000,
        },
      );
      return response.data as SolarInsights;
    } catch (error: any) {
      if ((error as any)?.isAxiosError) {
        if ((error as any).response?.status === 404) {
          this.logger.debug(`No solar data for ${lat},${lon}`);
          return null;
        }
        this.logger.error(`Solar API error: ${error.response?.status} ${error.response?.statusText}`);
      } else {
        this.logger.error(`Solar API error: ${error}`);
      }
      return null;
    }
  }

  async enrichPropertyWithRoofData(propertyId: string): Promise<any> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: { enrichments: true },
    });

    if (!property || !property.lat || !property.lon) {
      return null;
    }

    // Check if already enriched with roof data
    if (property.enrichments?.estimatedRoofSqft) {
      return property.enrichments;
    }

    const insights = await this.getBuildingInsights(property.lat, property.lon);

    if (!insights?.solarPotential) {
      return null;
    }

    const roofAreaSqft = Math.round(
      insights.solarPotential.wholeRoofStats.areaMeters2 * 10.7639,
    );
    const groundAreaSqft = Math.round(
      insights.solarPotential.wholeRoofStats.groundAreaMeters2 * 10.7639,
    );

    // Calculate average pitch from segments
    const segments = insights.solarPotential.roofSegmentStats || [];
    const avgPitch = segments.length > 0
      ? segments.reduce((sum, s) => sum + s.pitchDegrees, 0) / segments.length
      : 0;

    // Estimate material cost based on roof area
    // Average US roofing cost: $4-8 per sq ft installed
    const estimatedJobValue = Math.round(roofAreaSqft * 6); // $6/sqft midpoint

    // Store roof data as JSON in enrichment
    const solarRoofData = {
      totalRoofAreaSqft: roofAreaSqft,
      groundFootprintSqft: groundAreaSqft,
      avgPitchDegrees: Math.round(avgPitch * 10) / 10,
      maxPanelsCount: insights.solarPotential.maxArrayPanelsCount,
      maxSunshineHoursPerYear: insights.solarPotential.maxSunshineHoursPerYear,
      segmentCount: segments.length,
      segments: segments.map(s => ({
        areaSqft: Math.round(s.stats.areaMeters2 * 10.7639),
        pitchDegrees: s.pitchDegrees,
        azimuthDegrees: s.azimuthDegrees,
      })),
      imageryDate: insights.imageryDate,
      imageryQuality: insights.imageryQuality,
    };

    // Upsert enrichment
    const enrichment = await this.prisma.propertyEnrichment.upsert({
      where: { propertyId },
      create: {
        propertyId,
        estimatedRoofSqft: roofAreaSqft,
        estimatedJobValue,
        solarRoofData: solarRoofData as any,
      },
      update: {
        estimatedRoofSqft: roofAreaSqft,
        estimatedJobValue,
        solarRoofData: solarRoofData as any,
      },
    });

    return enrichment;
  }

  async bulkEnrichRoofs(limit: number = 50): Promise<{ enriched: number; failed: number; skipped: number }> {
    if (!this.apiKey) {
      return { enriched: 0, failed: 0, skipped: 0 };
    }

    // Find properties without roof data
    const properties = await this.prisma.property.findMany({
      where: {
        lat: { not: null },
        lon: { not: null },
        OR: [
          { enrichments: null },
          { enrichments: { estimatedRoofSqft: null } },
        ],
      },
      take: limit,
    });

    let enriched = 0;
    let failed = 0;
    let skipped = 0;

    for (const property of properties) {
      try {
        const result = await this.enrichPropertyWithRoofData(property.id);
        if (result) {
          enriched++;
        } else {
          skipped++;
        }
        // Rate limit: ~2 calls per second to stay well under limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        failed++;
        this.logger.error(`Failed to enrich ${property.id}: ${error}`);
      }
    }

    this.logger.log(`Roof enrichment complete: ${enriched} enriched, ${failed} failed, ${skipped} skipped`);
    return { enriched, failed, skipped };
  }
}
