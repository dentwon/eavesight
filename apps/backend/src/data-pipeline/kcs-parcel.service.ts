import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import axios from 'axios';

interface KcsAttribute {
  OBJECTID: number;
  PIN: string;
  PropertyAddress: string;
  PropertyOwner: string;
  AccountOwner: string;
  MailingAddress: string;
  PreviousOwners: string;
  TaxDistrict: string;
  TotalLandValue: number;
  TotalBuildingValue: number;
  TotalAppraisedValue: number;
  TotalAssessedValue: number;
  Acres: number;
  Subdivision: string;
  DeedDate: string;
}

interface KcsFeature {
  attributes: KcsAttribute;
}

interface KcsResponse {
  features: KcsFeature[];
  exceededTransferLimit?: boolean;
}

interface HarvestResult {
  stored: number;
  errors: number;
  exceededLimit: boolean;
  lastPIN?: string;
  lastOBJECTID?: number;
}

@Injectable()
export class KcsParcelService {
  private readonly logger = new Logger(KcsParcelService.name);
  private readonly BASE_URL =
    'https://web3.kcsgis.com/kcsgis/rest/services/Madison/Madison_Public_ISV/MapServer/185';
  private readonly BATCH_SIZE = 500;
  private readonly DELAY_MS = 1500;
  private readonly MAX_RETRIES = 3;

  constructor(private readonly prisma: PrismaService) {}

  async harvestBatch(offset: number, limit: number = 500): Promise<HarvestResult> {
    let attempt = 0;
    while (attempt < this.MAX_RETRIES) {
      attempt++;
      try {
        const response = await axios.get<KcsResponse>(`${this.BASE_URL}/query`, {
          params: {
            where: '1=1',
            outFields: [
              'OBJECTID,PIN,PropertyAddress,PropertyOwner,AccountOwner,MailingAddress',
              'PreviousOwners,TaxDistrict,TotalLandValue,TotalBuildingValue',
              'TotalAppraisedValue,TotalAssessedValue,Acres,Subdivision,DeedDate',
            ].join(','),
            resultOffset: offset,
            resultRecordCount: limit,
            returnGeometry: false,
            f: 'json',
          },
          timeout: 30000,
        });

        const features = response.data.features ?? [];
        const exceededLimit = response.data.exceededTransferLimit ?? false;

        if (features.length === 0) {
          return { stored: 0, errors: 0, exceededLimit: false };
        }

        const result = await this.upsertFromKcs(features);
        return {
          ...result,
          exceededLimit,
          lastPIN: features[features.length - 1].attributes.PIN,
          lastOBJECTID: features[features.length - 1].attributes.OBJECTID,
        };
      } catch (err) {
        this.logger.warn(`Batch ${offset} attempt ${attempt} failed: ${err.message}`);
        if (attempt === this.MAX_RETRIES) {
          return { stored: 0, errors: 1, exceededLimit: false };
        }
        await this.sleep(this.DELAY_MS * attempt * 2);
      }
    }
    return { stored: 0, errors: 1, exceededLimit: false };
  }

  async upsertFromKcs(features: KcsFeature[]): Promise<{ stored: number; errors: number }> {
    let stored = 0;
    let errors = 0;

    await Promise.all(
      features.map(async (feature) => {
        const a = feature.attributes;
        try {
          await this.prisma.madisonParcelData.upsert({
            where: { pin: a.PIN },
            update: {
              propertyOwner: a.PropertyOwner || null,
              accountOwner: a.AccountOwner || null,
              mailingAddress: a.MailingAddress || null,
              previousOwners: a.PreviousOwners || null,
              mailingAddressFull: a.MailingAddress
                ? this.normalizeAddress(a.MailingAddress)
                : null,
              lastOwnerEnrichedAt: new Date(),
            },
            create: {
              pin: a.PIN,
              objectId: a.OBJECTID,
              propertyAddress: a.PropertyAddress || null,
              propertyOwner: a.PropertyOwner || null,
              accountOwner: a.AccountOwner || null,
              mailingAddress: a.MailingAddress || null,
              previousOwners: a.PreviousOwners || null,
              mailingAddressFull: a.MailingAddress
                ? this.normalizeAddress(a.MailingAddress)
                : null,
              totalLandValue: a.TotalLandValue || null,
              totalBuildingValue: a.TotalBuildingValue || null,
              totalAppraisedValue: a.TotalAppraisedValue || null,
              totalAssessedValue: a.TotalAssessedValue || null,
              acres: a.Acres || null,
              subdivision: a.Subdivision || null,
              lastOwnerEnrichedAt: new Date(),
            },
          });
          stored++;
        } catch (err) {
          this.logger.warn(`Failed to upsert parcel ${a.PIN}: ${err.message}`);
          errors++;
        }
      }),
    );

    return { stored, errors };
  }

  normalizeAddress(address: string): string {
    if (!address) return '';
    return address.replace(/\s+/g, ' ').trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
