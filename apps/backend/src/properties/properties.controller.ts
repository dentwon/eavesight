import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PropertiesService } from './properties.service';
import { PropertyEnrichmentService } from '../data-pipeline/property-enrichment.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { LookupPropertyDto } from './dto/lookup-property.dto';
import { RevealMeterService } from './reveal-meter.service';

@ApiTags('properties')
@Controller('properties')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly enrichmentService: PropertyEnrichmentService,
    private readonly revealMeter: RevealMeterService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search properties' })
  search(@Query() searchDto: SearchPropertiesDto) {
    return this.propertiesService.search(searchDto);
  }

  @Get('in-bounds')
  @ApiOperation({ summary: 'Get properties in viewport bounds for map (no owner PII)' })
  async propertiesInBounds(
    @Query('north') north: string,
    @Query('south') south: string,
    @Query('east') east: string,
    @Query('west') west: string,
    @Query('limit') limit?: string,
    @Query('zoom') zoom?: string,
  ) {
    const n = parseFloat(north), s = parseFloat(south);
    const e = parseFloat(east), w = parseFloat(west);
    const lim = Math.min(parseInt(limit || '5000'), 10000);
    const z = parseInt(zoom || '13');
    const includeGeometry = z >= 15;
    return this.propertiesService.findInBounds(n, s, e, w, lim, includeGeometry);
  }

  @Get('nearest')
  @ApiOperation({ summary: 'Find nearest known property to GPS coords (for mobile quick-capture)' })
  nearest(@Query('lat') lat: string, @Query('lon') lon: string) {
    return this.propertiesService.nearest(parseFloat(lat), parseFloat(lon));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get property by ID (owner PII masked — call /reveal to unmask)' })
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.propertiesService.findOne(id, { orgId: req.user?.orgId, userId: req.user?.id }, false);
  }

  @Post(':id/reveal')
  @ApiOperation({ summary: 'Unmask owner PII for a property — consumes 1 reveal from quota' })
  reveal(@Req() req: any, @Param('id') id: string) {
    return this.propertiesService.findOne(id, { orgId: req.user?.orgId, userId: req.user?.id }, true);
  }

  @Get(':id/reveal/check')
  @ApiOperation({ summary: 'Check if a reveal would consume quota, without performing it' })
  checkReveal(@Req() req: any, @Param('id') id: string) {
    return this.revealMeter.checkReveal(req.user?.orgId, id, 'reveal');
  }

  @Post('lookup')
  @ApiOperation({ summary: 'Quick property lookup by address — returns masked fields only' })
  lookup(@Body() lookupDto: LookupPropertyDto) {
    return this.propertiesService.lookup(lookupDto);
  }

  @Get(':id/roof-age')
  @ApiOperation({ summary: 'Get roof age estimate for property' })
  getRoofAge(@Param('id') id: string) {
    return this.propertiesService.getRoofData(id);
  }

  @Post(':id/enrich')
  @Roles('SUPER_ADMIN')
  @Throttle({ expensive: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Enrich property with Census/FEMA public data (super-admin only)' })
  enrichProperty(@Param('id') id: string) {
    return this.enrichmentService.enrichProperty(id);
  }

  @Get(':id/enrichment')
  @ApiOperation({ summary: 'Get enrichment data for a property' })
  getEnrichment(@Param('id') id: string) {
    return this.enrichmentService.getEnrichment(id);
  }

  @Post('enrich-all')
  @Roles('SUPER_ADMIN')
  @Throttle({ expensive: { ttl: 60_000, limit: 1 } })
  @ApiOperation({ summary: 'Batch enrich unenriched properties (super-admin only — heavy)' })
  enrichAll(@Body() body?: { limit?: number }) {
    return this.enrichmentService.enrichAllProperties(body?.limit || 20);
  }
}
