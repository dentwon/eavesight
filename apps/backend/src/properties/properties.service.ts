import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { LookupPropertyDto } from './dto/lookup-property.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
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

    // For lat/lon search, you'd use PostGIS ST_DWithin
    // This is simplified
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
      },
    });

    return properties;
  }

  async findOne(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        propertyStorms: {
          include: { stormEvent: true },
        },
        leads: true,
      },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    return property;
  }

  async lookup(lookupDto: LookupPropertyDto) {
    const { address, city, state, zip } = lookupDto;

    // First check if we have it in our database
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
      },
    });

    // If not found, try external API (Estated, Smarty, etc.)
    if (!property) {
      property = await this.lookupExternal(lookupDto);
    }

    return property;
  }

  private async lookupExternal(lookupDto: LookupPropertyDto) {
    // This would integrate with external property APIs
    // For now, return null
    return null;
  }

  async getRoofAge(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      select: {
        id: true,
        yearBuilt: true,
        roofAge: true,
        roofYear: true,
        address: true,
      },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    // Calculate roof age based on available data
    let estimatedRoofAge: number | null = null;
    let roofAgeSource = 'unknown';

    if (property.roofAge) {
      estimatedRoofAge = property.roofAge;
      roofAgeSource = 'property_record';
    } else if (property.roofYear) {
      estimatedRoofAge = new Date().getFullYear() - property.roofYear;
      roofAgeSource = 'permit_data';
    } else if (property.yearBuilt) {
      // Estimate roof age as 15-20 years if no specific data
      estimatedRoofAge = new Date().getFullYear() - property.yearBuilt - 10;
      roofAgeSource = 'estimated_from_year_built';
    }

    return {
      propertyId: property.id,
      address: property.address,
      estimatedRoofAge,
      roofAgeSource,
      yearBuilt: property.yearBuilt,
      roofYear: property.roofYear,
      recommendations: this.getRoofRecommendations(estimatedRoofAge),
    };
  }

  private getRoofRecommendations(roofAge: number | null) {
    if (roofAge === null) {
      return 'No roof age data available. Consider scheduling an inspection.';
    }

    if (roofAge < 10) {
      return 'Roof appears relatively new. Likely no immediate replacement needed.';
    } else if (roofAge < 20) {
      return 'Roof is approaching mid-life. Monitor for signs of wear.';
    } else if (roofAge < 25) {
      return 'Roof is at typical lifespan end. Consider inspection and replacement.';
    } else {
      return 'Roof is past typical lifespan. Replacement likely needed.';
    }
  }
}
