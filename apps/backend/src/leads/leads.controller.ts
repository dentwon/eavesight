import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LeadsService } from './leads.service';
import { LeadScoringService } from './lead-scoring.service';
import { LeadGeneratorService } from './lead-generator.service';
import { CanvassingService } from './canvassing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRoles } from '../auth/roles.decorator';
import { CreateLeadDto, UpdateLeadDto } from './dto';

@ApiTags('leads')
@Controller('leads')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly scoringService: LeadScoringService,
    private readonly generatorService: LeadGeneratorService,
    private readonly canvassingService: CanvassingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all leads for organization' })
  findAll(@Request() req: any, @Query() query: any) {
    return this.leadsService.findAll(req.user.orgId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get lead statistics' })
  getStats(@Request() req: any) {
    return this.leadsService.getStats(req.user.orgId);
  }

  @Get('canvassing')
  @ApiOperation({ summary: 'Generate canvassing list for door-knocking' })
  getCanvassingList(
    @Request() req: any,
    @Query('stormId') stormId?: string,
    @Query('lat') lat?: string,
    @Query('lon') lon?: string,
    @Query('radius') radius?: string,
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
    @Query('status') status?: string,
  ) {
    return this.canvassingService.generateList({
      orgId: req.user.orgId,
      stormId,
      lat: lat ? parseFloat(lat) : undefined,
      lon: lon ? parseFloat(lon) : undefined,
      radiusKm: radius ? parseFloat(radius) : 15,
      limit: limit ? parseInt(limit) : 50,
      minScore: minScore ? parseInt(minScore) : 0,
      status,
    });
  }

  @Post('score-all')
  @OrgRoles('OWNER', 'ADMIN')
  @Throttle({ expensive: { ttl: 60_000, limit: 2 } })
  @ApiOperation({ summary: 'Re-score all leads for organization (org admin only — heavy)' })
  scoreAll(@Request() req: any) {
    return this.scoringService.scoreAllLeads(req.user.orgId);
  }

  // TODO(security): generator services currently don't receive orgId — they
  // write leads against whatever the service determines. Gating to org admins
  // narrows the blast radius; a follow-up should plumb req.user.orgId through
  // LeadGeneratorService so generated leads are guaranteed to belong to the
  // caller's org.
  @Post('generate')
  @OrgRoles('OWNER', 'ADMIN')
  @Throttle({ expensive: { ttl: 60_000, limit: 2 } })
  @ApiOperation({ summary: 'Generate leads from recent storms (org admin only — heavy)' })
  generateFromStorms(
    @Request() req: any,
    @Body() body: { days?: number },
  ) {
    return this.generatorService.generateFromRecentStorms(body?.days || 7);
  }

  @Post('generate/:stormId')
  @OrgRoles('OWNER', 'ADMIN')
  @Throttle({ expensive: { ttl: 60_000, limit: 2 } })
  @ApiOperation({ summary: 'Generate leads from a specific storm (org admin only — heavy)' })
  generateFromStorm(
    @Param('stormId') stormId: string,
    @Body() body: { radiusKm?: number },
  ) {
    return this.generatorService.generateFromStorm(stormId, body?.radiusKm || 30);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead by ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.findOne(id, req.user.orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new lead' })
  create(@Body() createLeadDto: CreateLeadDto, @Request() req: any) {
    return this.leadsService.create(req.user.orgId, createLeadDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a lead' })
  update(@Param('id') id: string, @Body() updateLeadDto: UpdateLeadDto, @Request() req: any) {
    return this.leadsService.update(id, req.user.orgId, updateLeadDto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update lead status' })
  updateStatus(@Param('id') id: string, @Body() body: { status: string }, @Request() req: any) {
    return this.leadsService.updateStatus(id, req.user.orgId, body.status);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Assign lead to user — assignee must belong to caller org' })
  assign(@Param('id') id: string, @Body() body: { assigneeId: string }, @Request() req: any) {
    return this.leadsService.assign(id, req.user.orgId, body.assigneeId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a lead' })
  delete(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.delete(id, req.user.orgId);
  }

  @Post('bulk')
  @OrgRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Bulk create leads (org admin only)' })
  bulkCreate(@Body() body: { leads: CreateLeadDto[] }, @Request() req: any) {
    return this.leadsService.bulkCreate(req.user.orgId, body.leads);
  }
}
