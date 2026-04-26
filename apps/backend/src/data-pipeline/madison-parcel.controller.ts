import { Controller, Get, Post, Body, Param, Query, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MadisonParcelService } from './madison-parcel.service';

@ApiTags('madison')
@Controller('madison')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MadisonParcelController {
  constructor(private readonly parcelService: MadisonParcelService) {}

  @Get('search')
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
  @ApiOperation({ summary: 'Get parcel details by PIN' })
  getByPin(@Param('pin') pin: string) {
    return this.parcelService.getByPin(pin);
  }

  @Post('leads')
  @ApiOperation({ summary: 'Create a lead from a parcel PIN' })
  createLead(
    @Req() req: any,
    @Body() body: { parcelId: string; firstName?: string; lastName?: string; phone?: string; email?: string; notes?: string; source?: string },
  ) {
    const orgId = req.user?.orgId;
    if (!orgId) {
      throw new BadRequestException('No organization context for current user');
    }
    // orgId is now sourced from the JWT, never the request body — prevents
    // cross-tenant lead injection.
    return this.parcelService.createLeadFromParcel({ ...body, orgId });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get data coverage stats' })
  getStats() {
    return this.parcelService.getStats();
  }

  @Get('map')
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
