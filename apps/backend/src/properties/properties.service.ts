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
        roofData: true,
        buildingFootprint: true,
        enrichments: true,
      },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    return property;
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
      // Fall back to MadisonParcelData
      const parcel = await this.prisma.madisonParcelData.findFirst({
        where: {
          propertyAddress: { contains: address.toUpperCase() },
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

    const roofData = property.roofData;
    let estimatedAge: number | null = null;
    let ageSource = 'unknown';

    if (roofData?.age) {
      estimatedAge = roofData.age;
      ageSource = 'roof_record';
    } else if (property.yearBuilt) {
      estimatedAge = new Date().getFullYear() - property.yearBuilt;
      ageSource = 'estimated_from_year_built';
    }

    return {
      propertyId: property.id,
      address: property.address,
      roofData: roofData || null,
      buildingFootprint: property.buildingFootprint || null,
      estimatedAge,
      ageSource,
      yearBuilt: property.yearBuilt,
      recommendations: this.getRoofRecommendations(estimatedAge),
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
        ownerFullName: true,
        assessedValue: true,
        yearBuilt: true,
        propertyType: true,
        onDncList: true,
        ownerPhone: true,
        ownerEmail: true,
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
          ownerFullName: true,
          assessedValue: true,
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

    // Fall back to MadisonParcelData (no lat/lon but has address search)
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
      ownerFullName: p.propertyOwner,
      assessedValue: p.totalAppraisedValue,
      parcel: p,
    }));
  }

}