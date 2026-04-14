import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../common/prisma.service';

interface ParcelAttributes {
  OBJECTID: number;
  PIN: string;
  PropertyAddress: string;
  TotalBuildingValue: number;
  TotalAppraisedValue: number;
  Acres: number;
  Zoning: string;
  EDistrictName: string;
  Wetland: string;
  FloodZone: string;
  HighSchool: string;
  HUBZone: string;
  IndustrialPark: string;
  LocalHistoricDistrict: string;
  NationalHistoricDistrict: string;
  HistoricBuilding: string;
  OpportunityZone: string;
  TIFDistrict: string;
  SlopeDistrict: string;
  TrafficCount: number;
  MajorRoad: string;
  BridgeStreet15: string;
  Hospital15: string;
  Marshall15: string;
  NHIP15: string;
  Toyota15: string;
  BridgeStreet30: string;
  Hospital30: string;
  Marshall30: string;
  NHIP30: string;
  Toyota30: string;
}

interface ParcelFeature {
  attributes: ParcelAttributes;
}

interface ArcGISResponse {
  features: ParcelFeature[];
  exceededTransferLimit?: boolean;
  error?: { message: string };
}

export interface HarvestStats {
  totalProcessed: number;
  totalStored: number;
  totalErrors: number;
  lastPIN: string | null;
  lastOBJECTID: number | null;
  batchCount: number;
  startedAt: Date;
  lastBatchAt: Date | null;
  status: 'idle' | 'running' | 'paused' | 'error';
  errorMessage: string | null;
}

@Injectable()
export class HuntsvilleParcelService {
  private readonly logger = new Logger(HuntsvilleParcelService.name);
  private readonly ARCGIS_BASE = 'https://maps.huntsvilleal.gov/server/rest/services/Planning/FindAProperty/MapServer';
  private readonly LAYER_MADISON = 1;

  // Harvest settings
  private readonly BATCH_SIZE = 500;
  private readonly BATCH_DELAY_MS = 1500;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 5000;

  private harvestStats: HarvestStats = this.initStats();

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  private initStats(): HarvestStats {
    return {
      totalProcessed: 0,
      totalStored: 0,
      totalErrors: 0,
      lastPIN: null,
      lastOBJECTID: null,
      batchCount: 0,
      startedAt: new Date(),
      lastBatchAt: null,
      status: 'idle',
      errorMessage: null,
    };
  }

  getStats(): HarvestStats {
    return { ...this.harvestStats };
  }

  resetStats(): void {
    this.harvestStats = this.initStats();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async queryArcGIS(
    offset: number,
    retries = 0,
  ): Promise<ArcGISResponse> {
    const url = `${this.ARCGIS_BASE}/${this.LAYER_MADISON}/query`;
    const params: Record<string, string> = {
      where: 'PIN IS NOT NULL',
      outFields: '*',
      resultRecordCount: this.BATCH_SIZE.toString(),
      resultOffset: offset.toString(),
      returnGeometry: 'false',
      f: 'json',
      outSR: '102629',
    };

    try {
      const response = await this.http.get(url, { params }).toPromise();
      if (!response?.data) throw new Error('Empty response from ArcGIS');
      return response.data as ArcGISResponse;
    } catch (error) {
      if (retries < this.MAX_RETRIES) {
        this.logger.warn(
          `Query failed (attempt ${retries + 1}/${this.MAX_RETRIES}), retrying in ${this.RETRY_DELAY_MS}ms...`,
        );
        await this.sleep(this.RETRY_DELAY_MS);
        return this.queryArcGIS(offset, retries + 1);
      }
      throw error;
    }
  }

  private async processBatch(parcels: ParcelFeature[]): Promise<{
    stored: number;
    errors: number;
  }> {
    let stored = 0;
    let errors = 0;

    for (const parcel of parcels) {
      const attrs = parcel.attributes;
      const pin = attrs.PIN?.toString().trim();
      if (!pin) continue;

      try {
        await this.prisma.madisonParcelData.upsert({
          where: { pin },
          update: {
            objectId: attrs.OBJECTID,
            propertyAddress: attrs.PropertyAddress,
            totalBuildingValue: attrs.TotalBuildingValue,
            totalAppraisedValue: attrs.TotalAppraisedValue,
            acres: attrs.Acres,
            zoning: attrs.Zoning,
            eDistrictName: attrs.EDistrictName,
            wetland: attrs.Wetland,
            floodZone: attrs.FloodZone,
            highSchool: attrs.HighSchool,
            hubZone: attrs.HUBZone,
            industrialPark: attrs.IndustrialPark,
            localHistoricDistrict: attrs.LocalHistoricDistrict,
            nationalHistoricDistrict: attrs.NationalHistoricDistrict,
            historicBuilding: attrs.HistoricBuilding,
            opportunityZone: attrs.OpportunityZone,
            tifDistrict: attrs.TIFDistrict,
            slopeDistrict: attrs.SlopeDistrict,
            trafficCount: attrs.TrafficCount,
            majorRoad: attrs.MajorRoad,
            bridgeStreet15: attrs.BridgeStreet15,
            hospital15: attrs.Hospital15,
            marshall15: attrs.Marshall15,
            nhip15: attrs.NHIP15,
            toyota15: attrs.Toyota15,
            bridgeStreet30: attrs.BridgeStreet30,
            hospital30: attrs.Hospital30,
            marshall30: attrs.Marshall30,
            nhip30: attrs.NHIP30,
            toyota30: attrs.Toyota30,
            lastHarvestedAt: new Date(),
          },
          create: {
            pin,
            objectId: attrs.OBJECTID,
            propertyAddress: attrs.PropertyAddress,
            totalBuildingValue: attrs.TotalBuildingValue,
            totalAppraisedValue: attrs.TotalAppraisedValue,
            acres: attrs.Acres,
            zoning: attrs.Zoning,
            eDistrictName: attrs.EDistrictName,
            wetland: attrs.Wetland,
            floodZone: attrs.FloodZone,
            highSchool: attrs.HighSchool,
            hubZone: attrs.HUBZone,
            industrialPark: attrs.IndustrialPark,
            localHistoricDistrict: attrs.LocalHistoricDistrict,
            nationalHistoricDistrict: attrs.NationalHistoricDistrict,
            historicBuilding: attrs.HistoricBuilding,
            opportunityZone: attrs.OpportunityZone,
            tifDistrict: attrs.TIFDistrict,
            slopeDistrict: attrs.SlopeDistrict,
            trafficCount: attrs.TrafficCount,
            majorRoad: attrs.MajorRoad,
            bridgeStreet15: attrs.BridgeStreet15,
            hospital15: attrs.Hospital15,
            marshall15: attrs.Marshall15,
            nhip15: attrs.NHIP15,
            toyota15: attrs.Toyota15,
            bridgeStreet30: attrs.BridgeStreet30,
            hospital30: attrs.Hospital30,
            marshall30: attrs.Marshall30,
            nhip30: attrs.NHIP30,
            toyota30: attrs.Toyota30,
            lastHarvestedAt: new Date(),
          },
        });

        stored++;
        this.harvestStats.lastPIN = pin;
        this.harvestStats.lastOBJECTID = attrs.OBJECTID;
      } catch (err) {
        errors++;
        this.logger.warn(`Failed to store parcel ${pin}: ${(err as Error).message}`);
      }
    }

    return { stored, errors };
  }

  async harvestBatch(offset: number = 0): Promise<{
    success: boolean;
    offset: number;
    stored: number;
    errors: number;
    exceededLimit: boolean;
    message: string;
  }> {
    this.logger.log(`Harvesting batch at offset ${offset}...`);

    try {
      const data = await this.queryArcGIS(offset);

      if (data.error) {
        return {
          success: false,
          offset,
          stored: 0,
          errors: 0,
          exceededLimit: false,
          message: `ArcGIS error: ${data.error.message}`,
        };
      }

      const parcels = data.features || [];
      const exceededLimit = data.exceededTransferLimit === true;

      if (parcels.length === 0) {
        return {
          success: true,
          offset,
          stored: 0,
          errors: 0,
          exceededLimit: false,
          message: 'No more parcels to harvest',
        };
      }

      const { stored, errors } = await this.processBatch(parcels);

      this.harvestStats.totalProcessed += parcels.length;
      this.harvestStats.totalStored += stored;
      this.harvestStats.totalErrors += errors;
      this.harvestStats.batchCount++;
      this.harvestStats.lastBatchAt = new Date();

      this.logger.log(
        `Batch complete: ${stored} stored, ${errors} errors | ` +
        `Total: ${this.harvestStats.totalProcessed} processed, ${this.harvestStats.totalStored} stored | ` +
        `Last PIN: ${this.harvestStats.lastPIN} | Offset: ${offset}`,
      );

      return {
        success: true,
        offset,
        stored,
        errors,
        exceededLimit,
        message: `Batch stored ${stored}/${parcels.length} parcels`,
      };
    } catch (error) {
      this.harvestStats.status = 'error';
      this.harvestStats.errorMessage = (error as Error).message;
      this.logger.error(`Batch failed: ${(error as Error).message}`);

      return {
        success: false,
        offset,
        stored: 0,
        errors: 0,
        exceededLimit: false,
        message: `Error: ${(error as Error).message}`,
      };
    }
  }

  async runFullHarvest(options: {
    startOffset?: number;
    maxBatches?: number;
    onProgress?: (stats: HarvestStats) => void;
  } = {}): Promise<HarvestStats> {
    const { startOffset = 0, maxBatches = 999999 } = options;

    this.harvestStats.status = 'running';
    this.harvestStats.startedAt = new Date();

    let offset = startOffset;
    let batchesRun = 0;

    try {
      while (batchesRun < maxBatches) {
        const result = await this.harvestBatch(offset);

        if (!result.success) {
          this.logger.error(`Harvest stopped due to error: ${result.message}`);
          break;
        }

        if (result.stored === 0 && !result.exceededLimit) {
          this.logger.log('Harvest complete - no more parcels');
          break;
        }

        batchesRun++;
        offset += this.BATCH_SIZE;

        if (options.onProgress) {
          options.onProgress(this.getStats());
        }

        if (result.exceededLimit || result.stored > 0) {
          await this.sleep(this.BATCH_DELAY_MS);
        }
      }
    } catch (error) {
      this.harvestStats.status = 'error';
      this.harvestStats.errorMessage = (error as Error).message;
    }

    if (this.harvestStats.status === 'running') {
      this.harvestStats.status = 'idle';
    }

    return this.getStats();
  }

  async getHarvestedCount(): Promise<number> {
    return this.prisma.madisonParcelData.count();
  }

  async sampleParcels(count: number = 10): Promise<any[]> {
    return this.prisma.madisonParcelData.findMany({
      take: count,
      orderBy: { objectId: 'asc' },
    });
  }
}
