import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface SearchOptions {
  query: string;
  limit?: number;
}

export interface ParcelLead {
  pin: string;
  objectId: number | null;
  propertyAddress: string | null;
  propertyOwner: string | null;
  mailingAddress: string | null;
  mailingAddressFull: string | null;
  totalAppraisedValue: number | null;
  totalBuildingValue: number | null;
  totalLandValue: number | null;
  totalAssessedValue: number | null;
  zoning: string | null;
  floodZone: string | null;
  acres: number | null;
  subdivision: string | null;
  highSchool: string | null;
  hubZone: string | null;
  propertyDescription: string | null;
  deedDate: Date | null;
  lastOwnerEnrichedAt: Date | null;
}

@Injectable()
export class MadisonParcelService {
  private readonly logger = new Logger(MadisonParcelService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search parcels by partial address, owner name, or PIN.
   * All parcels are in Madison County, AL.
   */
  async search(opts: SearchOptions): Promise<ParcelLead[]> {
    const { query, limit = 50 } = opts;
    const where: any = {};

    if (query && query.trim().length > 0) {
      const q = query.toUpperCase().trim();
      where.OR = [
        { propertyAddress: { contains: q } },
        { mailingAddress: { contains: q } },
        { propertyOwner: { contains: q } },
        { pin: { contains: q } },
      ];
    }

    const parcels = await this.prisma.madisonParcelData.findMany({
      where,
      take: limit,
      orderBy: { pin: 'asc' },
    });

    return parcels.map(p => this.formatParcel(p));
  }

  /**
   * Get all parcels (paginated).
   */
  async searchByCity(_city: string, limit: number = 500): Promise<ParcelLead[]> {
    const parcels = await this.prisma.madisonParcelData.findMany({
      take: limit,
      orderBy: { pin: 'asc' },
    });
    return parcels.map(p => this.formatParcel(p));
  }

  /**
   * Get a single parcel by PIN.
   */
  async getByPin(pin: string) {
    const parcel = await this.prisma.madisonParcelData.findUnique({
      where: { pin },
    });

    if (!parcel) {
      throw new NotFoundException(`Parcel ${pin} not found`);
    }

    const existingLead = await this.prisma.lead.findFirst({
      where: { parcelId: pin },
    });

    return {
      ...this.formatParcel(parcel),
      lead: existingLead
        ? {
            id: existingLead.id,
            status: existingLead.status,
            score: existingLead.score,
            priority: existingLead.priority,
            firstName: existingLead.firstName,
            lastName: existingLead.lastName,
            phone: existingLead.phone,
            email: existingLead.email,
          }
        : null,
    };
  }

  /**
   * Create a lead from a Madison County parcel.
   */
  async createLeadFromParcel(dto: {
    pin: string;
    orgId: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    notes?: string;
  }) {
    const parcel = await this.prisma.madisonParcelData.findUnique({
      where: { pin: dto.pin },
    });

    if (!parcel) {
      throw new NotFoundException(`Parcel ${dto.pin} not found`);
    }

    const existing = await this.prisma.lead.findFirst({
      where: { parcelId: dto.pin, orgId: dto.orgId },
    });

    if (existing) {
      return {
        message: 'Lead already exists for this parcel',
        lead: existing,
        parcel: this.formatParcel(parcel),
      };
    }

    const ownerName = parcel.propertyOwner || '';
    const nameParts = this.parseOwnerName(ownerName);

    const lead = await this.prisma.lead.create({
      data: {
        orgId: dto.orgId,
        parcelId: dto.pin,
        firstName: dto.firstName || nameParts.firstName,
        lastName: dto.lastName || nameParts.lastName,
        phone: dto.phone || null,
        email: dto.email || null,
        status: 'NEW',
        source: 'Madison County Parcel',
        priority: 'MEDIUM',
        notes: dto.notes || `Parcel: ${parcel.propertyAddress}, Owner: ${parcel.propertyOwner}`,
      },
    });

    const score = this.scoreParcelLead(parcel);
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { score },
    });

    this.logger.log(`Created lead ${lead.id} for parcel ${dto.pin} (score: ${score})`);

    return {
      lead: { ...lead, score },
      parcel: this.formatParcel(parcel),
    };
  }

  /**
   * Score a lead based on parcel/enrichment data. Max 100 pts.
   */
  private scoreParcelLead(parcel: any): number {
    let score = 0;

    // Property value (max 25 pts)
    const value = parcel.totalAppraisedValue;
    if (value) {
      if (value >= 400000) score += 25;
      else if (value >= 300000) score += 21;
      else if (value >= 200000) score += 17;
      else if (value >= 150000) score += 13;
      else if (value >= 100000) score += 9;
      else score += 5;
    } else {
      score += 7;
    }

    // Land value (max 10 pts)
    const landValue = parcel.totalLandValue;
    if (landValue) {
      if (landValue >= 100000) score += 10;
      else if (landValue >= 50000) score += 7;
      else if (landValue >= 20000) score += 4;
      else score += 2;
    }

    // Lot size (max 10 pts)
    const acres = parcel.acres;
    if (acres) {
      if (acres >= 5) score += 10;
      else if (acres >= 2) score += 7;
      else if (acres >= 1) score += 5;
      else if (acres >= 0.5) score += 3;
      else score += 2;
    }

    // Zoning (max 5 pts)
    const zoning = (parcel.zoning || '').toUpperCase();
    if (zoning.includes('R1') || zoning.includes('R2') || zoning.includes('RS')) score += 5;
    else if (zoning.includes('R3')) score += 3;
    else if (zoning.includes('AG') || zoning.includes('EST')) score += 4;
    else score += 2;

    // Flood zone (max 10 pts) — flood risk = insurance claim potential
    const flood = (parcel.floodZone || '').toUpperCase();
    if (flood === 'AE' || flood === 'AH' || flood === 'AO') score += 10;
    else if (flood === 'X' || flood === 'X500') score += 3;
    else if (flood === 'B' || flood === 'C') score += 5;
    else score += 2;

    // HubZone (max 5 pts)
    const hub = (parcel.hubZone || '').toUpperCase();
    if (hub === 'YES' || hub === 'TRUE') score += 5;
    else score += 2;

    // Owner-occupied (max 10 pts)
    if (parcel.mailingAddress && parcel.propertyAddress) {
      const mail = parcel.mailingAddress.toUpperCase();
      const prop = parcel.propertyAddress.toUpperCase();
      const sameCity = mail.includes('HUNTSVILLE') || mail.includes('MADISON') || mail.includes('HAZEL GREEN');
      if (mail.includes(prop.split(' ')[0] || '') && sameCity) score += 10;
      else if (sameCity) score += 7;
      else score += 4;
    } else {
      score += 5;
    }

    // Owner name (max 5 pts)
    if (parcel.propertyOwner && parcel.propertyOwner.length > 3) score += 5;
    else score += 2;

    // School district (max 5 pts)
    const school = parcel.highSchool || '';
    if (school.includes('HS')) score += 3;
    else if (school) score += 5;
    else score += 2;

    // Building value (max 15 pts)
    const bldgValue = parcel.totalBuildingValue;
    if (bldgValue) {
      if (bldgValue >= 300000) score += 15;
      else if (bldgValue >= 200000) score += 12;
      else if (bldgValue >= 100000) score += 8;
      else if (bldgValue >= 50000) score += 4;
      else score += 2;
    }

    return Math.max(0, Math.min(100, score));
  }

  private parseOwnerName(ownerName: string): { firstName: string; lastName: string } {
    if (!ownerName) return { firstName: '', lastName: '' };
    const cleaned = ownerName
      .replace(/\bLLC\b/gi, '').replace(/\bINC\b/gi, '').replace(/\bLTD\b/gi, '')
      .replace(/&.*$/, '').replace(/\*\*\*/g, '').trim();

    if (cleaned.includes(',')) {
      const [last, first] = cleaned.split(',').map(s => s.trim());
      return { firstName: first || '', lastName: last || '' };
    }
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) {
      return { firstName: parts[0], lastName: parts[parts.length - 1] };
    }
    return { firstName: '', lastName: cleaned };
  }

  /**
   * Get data coverage stats for the UI.
   */
  async getStats() {
    const [total, withOwner, withMailing, withValue, withZoning, withFlood] = await Promise.all([
      this.prisma.madisonParcelData.count(),
      this.prisma.madisonParcelData.count({ where: { propertyOwner: { not: null } } }),
      this.prisma.madisonParcelData.count({ where: { mailingAddress: { not: null } } }),
      this.prisma.madisonParcelData.count({ where: { totalAppraisedValue: { not: null } } }),
      this.prisma.madisonParcelData.count({ where: { zoning: { not: null } } }),
      this.prisma.madisonParcelData.count({ where: { floodZone: { not: null } } }),
    ]);

    return {
      totalParcels: total,
      withOwnerNames: withOwner,
      withMailingAddress: withMailing,
      withPropertyValue: withValue,
      withZoning: withZoning,
      withFloodZone: withFlood,
      coverage: {
        ownerNames: total > 0 ? Math.round((withOwner / total) * 100) : 0,
        propertyValue: total > 0 ? Math.round((withValue / total) * 100) : 0,
        zoning: total > 0 ? Math.round((withZoning / total) * 100) : 0,
        floodZone: total > 0 ? Math.round((withFlood / total) * 100) : 0,
      },
    };
  }

  private formatParcel(p: any): ParcelLead {
    return {
      pin: p.pin,
      objectId: p.objectId,
      propertyAddress: p.propertyAddress,
      propertyOwner: p.propertyOwner,
      mailingAddress: p.mailingAddress,
      mailingAddressFull: p.mailingAddressFull,
      totalAppraisedValue: p.totalAppraisedValue,
      totalBuildingValue: p.totalBuildingValue,
      totalLandValue: p.totalLandValue,
      totalAssessedValue: p.totalAssessedValue,
      zoning: p.zoning,
      floodZone: p.floodZone,
      acres: p.acres,
      subdivision: p.subdivision,
      highSchool: p.highSchool,
      hubZone: p.hubZone,
      propertyDescription: p.propertyDescription,
      deedDate: p.deedDate,
      lastOwnerEnrichedAt: p.lastOwnerEnrichedAt,
    };
  }
}
