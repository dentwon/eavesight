import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MapService, MapLayer } from './map.service';

@ApiTags('map')
@Controller('map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get('scores')
  @ApiOperation({ summary: 'Per-building scores for a viewport' })
  async scores(
    @Query('layer') layer: MapLayer = 'lead_score',
    @Query('minLon') minLon: string,
    @Query('minLat') minLat: string,
    @Query('maxLon') maxLon: string,
    @Query('maxLat') maxLat: string,
    @Query('limit') limit?: string,
  ) {
    const bbox = {
      minLon: parseFloat(minLon),
      minLat: parseFloat(minLat),
      maxLon: parseFloat(maxLon),
      maxLat: parseFloat(maxLat),
    };
    const lim = Math.min(parseInt(limit || '50000'), 200000);
    const scores = await this.mapService.scoresForBbox(layer, bbox, lim);
    return { layer, bbox, scores };
  }
}
