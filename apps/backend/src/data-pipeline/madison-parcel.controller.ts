import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { MadisonParcelService } from './madison-parcel.service';

@ApiTags('madison')
@Controller('madison')
export class MadisonParcelController {
  constructor(private readonly parcelService: MadisonParcelService) {}

  @Get('search')
  @Public()
  @ApiOperation({ summary: 'Search Madison County parcels by address' })
  search(
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ) {
    return this.parcelService.search({
      query: query || '',
      limit: Math.min(parseInt(limit || '50'), 200),
    });
  }

  @Get('parcels')
  @Public()
  @ApiOperation({ summary: 'List parcels in bounds (no geometry - uses address match)' })
  async getParcelsInBounds(
    @Query('north') north: string,
    @Query('south') south: string,
    @Query('east') east: string,
    @Query('west') west: string,
    @Query('limit') limit?: string,
  ) {
    // Note: MadisonParcelData has no lat/lon yet
    // Huntsville harvest will populate coordinates eventually
    return this.parcelService.searchByCity('HUNTSVILLE', parseInt(limit || '500'));
  }

  @Get('parcels/:pin')
  @Public()
  @ApiOperation({ summary: 'Get parcel details by PIN' })
  getByPin(@Param('pin') pin: string) {
    return this.parcelService.getByPin(pin);
  }

  @Post('leads')
  @Public()
  @ApiOperation({ summary: 'Create a lead from a parcel PIN' })
  createLead(
    @Body() body: { parcelId: string; orgId?: string; firstName?: string; lastName?: string; phone?: string; email?: string; notes?: string; source?: string },
  ) {
    return this.parcelService.createLeadFromParcel(body);
  }

  @Get('stats')
  @Public()
  @ApiOperation({ summary: 'Get data coverage stats' })
  getStats() {
    return this.parcelService.getStats();
  }

  @Get('map')
  @Public()
  @ApiOperation({ summary: 'Get parcels in bounding box for map rendering' })
  async getMapParcels(
    @Query('north') north: string,
    @Query('south') south: string,
    @Query('east') east: string,
    @Query('west') west: string,
    @Query('limit') limit?: string,
    @Query('minValue') minValue?: string,
    @Query('roofAgeMin') roofAgeMin?: string,
    @Query('roofAgeMax') roofAgeMax?: string,
  ) {
    return this.parcelService.getMapParcels({
      north: parseFloat(north),
      south: parseFloat(south),
      east: parseFloat(east),
      west: parseFloat(west),
      limit: Math.min(parseInt(limit || '2000'), 5000),
      minValue: minValue ? parseFloat(minValue) : undefined,
    });
  }
}
