import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CensusService } from './census.service';
import { FemaService } from './fema.service';

/**
 * Property Enrichment Service
 *
 * Orchestrates data enrichment for properties by pulling from
 * multiple free public data sources and computing derived values.
 */
@Injectable()
export class PropertyEnrichmentService {
  private readonly logger = new Logger(PropertyEnrichmentService.name);

  // Average roofing costs per sqft by region (simplified)
  private readonly ROOFING_COST_PER_SQFT = {
    low: 3.50,    // basic 3-tab shingles
    mid: 5.50,    // architectural shingles
    high: 8.00,   // premium materials
    default: 5.50,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly censusService: CensusService,
    private readonly femaService: FemaService,
  ) {}

  /**
   * Enrich a single property with all available data
   */
  async enrichProperty(propertyId: string): Promise<any> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: { enrichments: true },
    });

    if (!property) {
      this.logger.warn(`Property ${propertyId} not found`);
      return null;
    }

    const enrichmentData: any = {};

    // Step 1: Geocode if missing coordinates
    if (!property.lat || !property.lon) {
      const geocodeResult = await this.censusService.geocodeAddress(
        property.address,
        property.city,
        property.state,
        property.zip,
      );

      if (geocodeResult) {
        // Update property coordinates
        await this.prisma.property.update({
          where: { id: propertyId },
          data: {
            lat: geocodeResult.lat,
            lon: geocodeResult.lon,
          },
        });

        enrichmentData.censusTract = geocodeResult.censusTract;
        enrichmentData.censusBlockGroup = geocodeResult.censusBlockGroup;
      }
    } else {
      // If we have coords but no census tract, geocode to get tract info
      if (!property.enrichments?.censusTract) {
        const geocodeResult = await this.censusService.geocodeAddress(
          property.address,
          property.city,
          property.state,
          property.zip,
        );
        if (geocodeResult) {
          enrichmentData.censusTract = geocodeResult.censusTract;
          enrichmentData.censusBlockGroup = geocodeResult.censusBlockGroup;
        }
      }
    }

    // Step 2: Fetch Census ACS demographics for the tract
    const tract = enrichmentData.censusTract || property.enrichments?.censusTract;
    if (tract) {
      // Need state and county FIPS codes
      const geocodeResult = await this.censusService.geocodeAddress(
        property.address,
        property.city,
        property.state,
        property.zip,
      );

      if (geocodeResult?.stateFips && geocodeResult?.countyFips) {
        const demographics = await this.censusService.getTractDemographics(
          geocodeResult.stateFips,
          geocodeResult.countyFips,
          tract,
        );

        if (demographics) {
          enrichmentData.medianHouseholdIncome = demographics.medianHouseholdIncome;
          enrichmentData.medianHomeValue = demographics.medianHomeValue;
          enrichmentData.homeownershipRate = demographics.homeownershipRate;
          enrichmentData.medianAge = demographics.medianAge;
        }
      }
    }

    // Step 3: Check FEMA disaster declarations
    const hasDisaster = await this.femaService.hasActiveDisaster(
      property.state,
      property.county || undefined,
    );
    enrichmentData.disasterDeclarationActive = hasDisaster;

    // Step 4: Estimate roof size and job value
    const roofSqft = this.estimateRoofSqft(property, enrichmentData);
    // Roof data now stored in roof_data table
    // Job value computed from roof_data

    enrichmentData.source = 'census+fema';

    // Upsert enrichment record
    const enrichment = await this.prisma.propertyEnrichment.upsert({
      where: { propertyId },
      update: enrichmentData,
      create: {
        propertyId,
        ...enrichmentData,
      },
    });

    this.logger.log(`Enriched property ${propertyId}: ${JSON.stringify({
      tract: enrichmentData.censusTract,
      income: enrichmentData.medianHouseholdIncome,
      homeValue: enrichmentData.medianHomeValue,
      roofSqft,
      jobValue: enrichmentData.estimatedJobValue,
      disaster: hasDisaster,
    })}`);

    return enrichment;
  }

  /**
   * Batch enrich all properties that lack enrichment data
   */
  async enrichAllProperties(limit: number = 50): Promise<{ enriched: number; total: number }> {
    const unenriched = await this.prisma.property.findMany({
      where: {
        enrichments: null,
      },
      take: limit,
    });

    this.logger.log(`Found ${unenriched.length} unenriched properties`);

    let enriched = 0;
    for (const property of unenriched) {
      try {
        await this.enrichProperty(property.id);
        enriched++;
        // Rate limit: be respectful to Census API
        await new Promise(r => setTimeout(r, 1500));
      } catch (error) {
        this.logger.warn(`Failed to enrich property ${property.id}: ${error.message}`);
      }
    }

    return { enriched, total: unenriched.length };
  }

  /**
   * Estimate roof square footage from available data
   *
   * Priority: building footprint > sqft estimate > assessed value proxy
   * Roof sqft is typically 1.1-1.3x the building footprint (depending on pitch)
   */
  private estimateRoofSqft(property: any, enrichments: any): number | null {
    // From property sqft (most accessible)
    if (property.sqft) {
      return Math.round(property.sqft * 1.15); // 15% pitch factor
    }

    // From median home value as proxy
    if (enrichments?.medianHomeValue) {
      const estimatedSqft = enrichments.medianHomeValue / 150;
      return Math.round(estimatedSqft * 1.15);
    }

    return null;
  }

  /**
   * Estimate roofing job value from roof sqft
   * Uses mid-range architectural shingle pricing
   */
  private estimateJobValue(roofSqft: number | null): number | null {
    if (!roofSqft) return null;

    // Convert sqft to roofing squares (1 square = 100 sqft)
    const squares = roofSqft / 100;

    // Average cost: $350-$550 per square installed (materials + labor)
    const costPerSquare = 450; // mid-range
    const baseJobCost = squares * costPerSquare;

    // Add tear-off, disposal, underlayment (~20% of base)
    const totalJobValue = baseJobCost * 1.2;

    return Math.round(totalJobValue);
  }

  /**
   * Get enrichment data for a property
   */
  async getEnrichment(propertyId: string) {
    return this.prisma.propertyEnrichment.findUnique({
      where: { propertyId },
    });
  }
}
