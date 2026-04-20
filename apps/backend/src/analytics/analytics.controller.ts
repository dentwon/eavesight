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

  // =================================================================
  // NEW: Team Operations — Day 1 dashboard
  // =================================================================

  @Get('team/leaderboard')
  @ApiOperation({ summary: 'Rep leaderboard with funnel KPIs' })
  getRepLeaderboard(@Request() req: any, @Query('days') days?: string) {
    const d = Math.max(1, Math.min(365, Number(days) || 30));
    return this.analyticsService.getRepLeaderboard(req.user.orgId, d);
  }

  @Get('pipeline/velocity')
  @ApiOperation({ summary: 'Pipeline stage velocity + conversion' })
  getPipelineVelocity(@Request() req: any, @Query('days') days?: string) {
    const d = Math.max(7, Math.min(365, Number(days) || 90));
    return this.analyticsService.getPipelineVelocity(req.user.orgId, d);
  }

  @Get('leads/decay')
  @ApiOperation({ summary: 'Uncontacted + stuck leads alert feed' })
  getLeadDecay(@Request() req: any) {
    return this.analyticsService.getLeadDecay(req.user.orgId);
  }

  @Get('territory/equity')
  @ApiOperation({ summary: 'Territory opportunity-per-rep fairness' })
  getTerritoryEquity(@Request() req: any) {
    return this.analyticsService.getTerritoryEquity(req.user.orgId);
  }

  @Get('forecast/revenue')
  @ApiOperation({ summary: '30/60/90 day pipeline-weighted revenue forecast' })
  getRevenueForecast(@Request() req: any) {
    return this.analyticsService.getRevenueForecast(req.user.orgId);
  }
}
