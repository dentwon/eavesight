import { Controller, Get, Post, Body, Inject, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { KcsParcelService } from './kcs-parcel.service';
import { PrismaService } from '../common/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface BatchResult {
  success: boolean;
  offset: number;
  stored: number;
  errors: number;
  exceededLimit: boolean;
  message: string;
}

interface HarvestStats {
  totalProcessed: number;
  totalStored: number;
  totalErrors: number;
  lastPIN: string;
  lastOBJECTID: number;
  batchCount: number;
  startedAt: string;
  lastBatchAt: string | null;
  status: 'idle' | 'running';
  errorMessage: string | null;
}

@Controller('harvester')
@UseGuards(JwtAuthGuard)
@Throttle({ expensive: { ttl: 60_000, limit: 5 } })
export class KcsParcelController {
  private harvestStats: HarvestStats = {
    totalProcessed: 0,
    totalStored: 0,
    totalErrors: 0,
    lastPIN: '',
    lastOBJECTID: 0,
    batchCount: 0,
    startedAt: new Date().toISOString(),
    lastBatchAt: null,
    status: 'idle',
    errorMessage: null,
  };

  constructor(
    private readonly harvester: KcsParcelService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('start-owner-enrichment')
  async startEnrichment(
    @Body() body: { startOffset?: number; maxBatches?: number; batchSize?: number },
  ) {
    const startOffset = body.startOffset ?? 0;
    const maxBatches = body.maxBatches ?? 999999;
    const batchSize = body.batchSize ?? 500;
    this.harvestStats = {
      totalProcessed: 0,
      totalStored: 0,
      totalErrors: 0,
      lastPIN: '',
      lastOBJECTID: 0,
      batchCount: 0,
      startedAt: new Date().toISOString(),
      lastBatchAt: null,
      status: 'running',
      errorMessage: null,
    };

    for (let offset = startOffset; offset < startOffset + maxBatches * batchSize; offset += batchSize) {
      const result = await this.harvester.harvestBatch(offset, batchSize);
      this.harvestStats.totalProcessed += result.stored + result.errors;
      this.harvestStats.totalStored += result.stored;
      this.harvestStats.totalErrors += result.errors;
      this.harvestStats.batchCount++;
      this.harvestStats.lastBatchAt = new Date().toISOString();
      if (result.lastPIN) this.harvestStats.lastPIN = result.lastPIN;
      if (result.lastOBJECTID) this.harvestStats.lastOBJECTID = result.lastOBJECTID;

      if (!result.exceededLimit) break;
    }

    this.harvestStats.status = 'idle';
    return this.harvestStats;
  }

  @Post('batch-owner')
  async runBatch(@Body() body: { offset?: number; batchSize?: number }): Promise<BatchResult> {
    const result = await this.harvester.harvestBatch(body.offset ?? 0, body.batchSize ?? 500);
    return {
      success: result.errors === 0,
      offset: body.offset ?? 0,
      stored: result.stored,
      errors: result.errors,
      exceededLimit: result.exceededLimit,
      message: `Owner enrichment: ${result.stored} updated, ${result.errors} errors`,
    };
  }

  @Get('owner-stats')
  async getStats(): Promise<HarvestStats> {
    return this.harvestStats;
  }

  @Get('owner-sample')
  async getSample() {
    const parcels = await this.prisma.madisonParcelData.findMany({
      take: 5,
      where: { propertyOwner: { not: null } },
      select: {
        pin: true,
        propertyAddress: true,
        propertyOwner: true,
        mailingAddress: true,
        mailingAddressFull: true,
        totalAppraisedValue: true,
      },
      orderBy: { objectId: 'asc' },
    });
    return parcels;
  }

  @Post('reset-owner-stats')
  async resetStats() {
    this.harvestStats = {
      totalProcessed: 0,
      totalStored: 0,
      totalErrors: 0,
      lastPIN: '',
      lastOBJECTID: 0,
      batchCount: 0,
      startedAt: new Date().toISOString(),
      lastBatchAt: null,
      status: 'idle',
      errorMessage: null,
    };
    return { ok: true };
  }
}
