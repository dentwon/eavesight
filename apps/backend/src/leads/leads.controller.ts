import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateLeadDto, UpdateLeadDto } from './dto';

@ApiTags('leads')
@Controller('leads')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

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
  @ApiOperation({ summary: 'Assign lead to user' })
  assign(@Param('id') id: string, @Body() body: { assigneeId: string }, @Request() req: any) {
    return this.leadsService.assign(id, req.user.orgId, body.assigneeId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a lead' })
  delete(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.delete(id, req.user.orgId);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk create leads' })
  bulkCreate(@Body() body: { leads: CreateLeadDto[] }, @Request() req: any) {
    return this.leadsService.bulkCreate(req.user.orgId, body.leads);
  }
}
