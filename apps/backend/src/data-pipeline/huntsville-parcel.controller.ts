import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HuntsvilleParcelService, HarvestStats } from './huntsville-parcel.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('harvester')
@UseGuards(JwtAuthGuard)
@Throttle({ expensive: { ttl: 60_000, limit: 5 } })
export class HuntsvilleParcelController {
  constructor(private readonly harvester: HuntsvilleParcelService) {}

  @Get('stats')
  getStats(): HarvestStats {
    return this.harvester.getStats();
  }

  @Get('count')
  async getCount(): Promise<{ count: number }> {
    const count = await this.harvester.getHarvestedCount();
    return { count };
  }

  @Get('sample')
  async getSample(@Query('count') count: string = '10'): Promise<{ count: number; parcels: any[] }> {
    const parcels = await this.harvester.sampleParcels(parseInt(count, 10) || 10);
    return { count: parcels.length, parcels };
  }

  @Post('batch')
  async runBatch(@Body() body: { offset?: number }): Promise<{
    success: boolean;
    offset: number;
    stored: number;
    errors: number;
    exceededLimit: boolean;
    message: string;
  }> {
    return this.harvester.harvestBatch(body.offset || 0);
  }

  @Post('start')
  async startHarvest(@Body() body: { startOffset?: number; maxBatches?: number }): Promise<HarvestStats> {
    return this.harvester.runFullHarvest({
      startOffset: body.startOffset || 0,
      maxBatches: body.maxBatches || 999999,
    });
  }

  @Post('reset')
  resetStats(): { message: string } {
    this.harvester.resetStats();
    return { message: 'Stats reset' };
  }
}
