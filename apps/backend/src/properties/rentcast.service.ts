import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import axios from 'axios';

@Injectable()
export class RentCastService {
  private readonly logger = new Logger(RentCastService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.rentcast.io/v1';
  private monthlyCallCount = 0;
  private currentMonth = new Date().getMonth();
  private readonly FREE_TIER_LIMIT = 50;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiKey = this.configService.get<string>('RENTCAST_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('RENTCAST_API_KEY not set');
    }
  }

  private checkRateLimit(): boolean {
    const now = new Date();
    if (now.getMonth() !== this.currentMonth) {
      this.currentMonth = now.getMonth();
      this.monthlyCallCount = 0;
    }
    return this.monthlyCallCount < this.FREE_TIER_LIMIT;
  }

  async lookupProperty(address: string): Promise<any> {
    if (!this.apiKey || !this.checkRateLimit()) return null;
    try {
      const response = await axios.get(`${this.baseUrl}/properties`, {
        params: { address },
        headers: { 'X-Api-Key': this.apiKey },
        timeout: 10000,
      });
      this.monthlyCallCount++;
      this.logger.log(`RentCast call #${this.monthlyCallCount}/${this.FREE_TIER_LIMIT}`);
      const data = response.data as any[];
      return data?.length > 0 ? data[0] : null;
    } catch (error: any) {
      if (error?.response?.status === 429) {
        this.monthlyCallCount = this.FREE_TIER_LIMIT;
      }
      this.logger.error(`RentCast error: ${error?.response?.status || error.message}`);
      return null;
    }
  }

  async enrichProperty(propertyId: string): Promise<any> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) return null;

    const address = `${property.address}, ${property.city}, ${property.state} ${property.zip}`;
    const rcData = await this.lookupProperty(address);
    if (!rcData) return null;

    const updated = await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        yearBuilt: rcData.yearBuilt || property.yearBuilt,
        sqft: rcData.squareFootage || property.sqft,
        bedrooms: rcData.bedrooms || property.bedrooms,
        bathrooms: rcData.bathrooms || property.bathrooms,
        assessedValue: rcData.assessedValue || property.assessedValue,
        lastSalePrice: rcData.lastSalePrice || property.lastSalePrice,
        lastSaleDate: rcData.lastSaleDate ? new Date(rcData.lastSaleDate) : property.lastSaleDate,
        county: rcData.county || property.county,
        ownerFullName: rcData.ownerName || property.ownerFullName,
        rentcastId: rcData.id || property.rentcastId,
        source: 'rentcast',
        sourceUpdatedAt: new Date(),
      },
    });

    return updated;
  }

  getRemainingCalls(): number {
    return Math.max(0, this.FREE_TIER_LIMIT - this.monthlyCallCount);
  }
}
