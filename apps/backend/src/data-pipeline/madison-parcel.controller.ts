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
    @Query('city') city?: string,
    @Query('limit') limit?: string,
  ) {
    return this.parcelService.search({
      query: query || '',
      city: city || 'HUNTSVILLE',
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
    // Note: Without lat/lon on parcels, we fall back to address search
    // The Huntsville harvest will eventually populate lat/lon
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
    @Body() body: { pin: string; orgId: string; firstName?: string; lastName?: string; phone?: string; email?: string; notes?: string },
  ) {
    return this.parcelService.createLeadFromParcel(body);
  }

  @Get('stats')
  @Public()
  @ApiOperation({ summary: 'Get data coverage stats' })
  getStats() {
    return this.parcelService.getStats();
  }
}
