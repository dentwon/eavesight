import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { LookupPropertyDto } from './dto/lookup-property.dto';

@ApiTags('properties')
@Controller('properties')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  @ApiOperation({ summary: 'Search properties' })
  search(@Query() searchDto: SearchPropertiesDto) {
    return this.propertiesService.search(searchDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get property by ID' })
  findOne(@Param('id') id: string) {
    return this.propertiesService.findOne(id);
  }

  @Post('lookup')
  @ApiOperation({ summary: 'Quick property lookup by address' })
  lookup(@Body() lookupDto: LookupPropertyDto) {
    return this.propertiesService.lookup(lookupDto);
  }

  @Get(':id/roof-age')
  @ApiOperation({ summary: 'Get roof age estimate for property' })
  getRoofAge(@Param('id') id: string) {
    return this.propertiesService.getRoofAge(id);
  }
}
