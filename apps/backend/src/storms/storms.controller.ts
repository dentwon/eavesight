import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { StormsService } from './storms.service';
import { NoaaService } from './noaa.service';
import { SpcService } from './spc.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { GetStormsDto } from './dto/get-storms.dto';

@ApiTags('storms')
@Controller('storms')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StormsController {
  constructor(
    private readonly stormsService: StormsService,
    private readonly noaaService: NoaaService,
    private readonly spcService: SpcService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get storm events with filters' })
  findAll(@Query() getStormsDto: GetStormsDto) {
    return this.stormsService.findAll(getStormsDto);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get currently active storms' })
  findActive() {
    return this.stormsService.findActive();
  }

  @Get('nearby')
  @ApiOperation({ summary: 'Get storms near a location' })
  findNearby(@Query() query: { lat: string; lon: string; radius?: string }) {
    return this.stormsService.findNearby(
      parseFloat(query.lat),
      parseFloat(query.lon),
      query.radius ? parseFloat(query.radius) : 50,
    );
  }

  @Get('zones')
  @ApiOperation({ summary: 'Get storm zones aggregated by county' })
  getZones(@Query('state') state: string, @Query('limit') limit?: string) {
    return this.stormsService.getStormZones(state, limit ? parseInt(limit) : 100);
  }

  // --- Sync Endpoints (manual triggers) ---

  @Post('sync/spc')
  @Throttle({ expensive: { ttl: 60_000, limit: 2 } })
  @ApiOperation({ summary: 'Manually sync today\'s SPC storm reports' })
  syncSpc() {
    return this.spcService.syncToday();
  }

  @Post('sync/spc/history')
  @Throttle({ expensive: { ttl: 60_000, limit: 1 } })
  @ApiOperation({ summary: 'Sync SPC historical data for a date range' })
  syncSpcHistory(@Body() body: { startDate: string; endDate: string }) {
    return this.spcService.syncDateRange(
      new Date(body.startDate),
      new Date(body.endDate),
    );
  }

  @Post('sync/noaa')
  @Throttle({ expensive: { ttl: 60_000, limit: 1 } })
  @ApiOperation({ summary: 'Manually sync NOAA historical storm data' })
  syncNoaa(@Body() body?: { state?: string; years?: number[]; limit?: number }) {
    return this.noaaService.syncStormEvents({
      state: body?.state,
      years: body?.years,
      limit: body?.limit,
    });
  }

  @Public()
  @Get('heatmap')
  @ApiOperation({ summary: 'Get hail/tornado frequency heat map grid as GeoJSON' })
  getHeatmap(
    @Query('north') north: string,
    @Query('south') south: string,
    @Query('east') east: string,
    @Query('west') west: string,
    @Query('gridSize') gridSize?: string,
    @Query('months') months?: string,
  ) {
    return this.stormsService.getHailFrequencyGrid(
      parseFloat(north),
      parseFloat(south),
      parseFloat(east),
      parseFloat(west),
      gridSize ? parseFloat(gridSize) : 0.05,
      months ? parseInt(months) : 24,
    );
  }

  @Public()
  @Get('tracks')
  @ApiOperation({
    summary: 'Get storm trajectories (LineStrings) within bbox for last N months',
  })
  getTracks(
    @Query('north') north: string,
    @Query('south') south: string,
    @Query('east') east: string,
    @Query('west') west: string,
    @Query('months') months?: string,
    @Query('types') types?: string,
  ) {
    const typeList = types ? types.split(',').map(t => t.trim().toUpperCase()) : undefined;
    return this.stormsService.getStormTracks(
      parseFloat(north),
      parseFloat(south),
      parseFloat(east),
      parseFloat(west),
      months ? parseInt(months) : 24,
      typeList,
    );
  }

  @Public()
  @Get('swaths')
  @ApiOperation({
    summary: 'Storm damage footprints (polygon swaths + centerlines + points) for rich map rendering',
  })
  getSwaths(
    @Query('north') north: string,
    @Query('south') south: string,
    @Query('east') east: string,
    @Query('west') west: string,
    @Query('months') months?: string,
    @Query('types') types?: string,
  ) {
    const typeList = types ? types.split(',').map(t => t.trim().toUpperCase()) : undefined;
    return this.stormsService.getStormSwaths(
      parseFloat(north),
      parseFloat(south),
      parseFloat(east),
      parseFloat(west),
      months ? parseInt(months) : 24,
      typeList,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get storm by ID' })
  findOne(@Param('id') id: string) {
    return this.stormsService.findOne(id);
  }
}
