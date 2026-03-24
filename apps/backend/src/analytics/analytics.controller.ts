import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview' })
  getOverview(@Request() req: any) {
    return this.analyticsService.getOverview(req.user.orgId);
  }

  @Get('leads-by-month')
  @ApiOperation({ summary: 'Get leads grouped by month' })
  getLeadsByMonth(@Request() req: any, @Query('months') months?: number) {
    return this.analyticsService.getLeadsByMonth(req.user.orgId, months || 6);
  }

  @Get('storm-impact')
  @ApiOperation({ summary: 'Get storm impact analytics' })
  getStormImpact(@Request() req: any) {
    return this.analyticsService.getStormImpact(req.user.orgId);
  }
}
