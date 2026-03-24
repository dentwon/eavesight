import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StormsService } from './storms.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetStormsDto } from './dto/get-storms.dto';

@ApiTags('storms')
@Controller('storms')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StormsController {
  constructor(private readonly stormsService: StormsService) {}

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
  findNearby(@Query() query: { lat: number; lon: number; radius?: number }) {
    return this.stormsService.findNearby(query.lat, query.lon, query.radius || 50);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get storm by ID' })
  findOne(@Param('id') id: string) {
    return this.stormsService.findOne(id);
  }
}
