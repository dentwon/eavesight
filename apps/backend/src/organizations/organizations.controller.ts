import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@ApiTags('organizations')
@Controller('orgs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all organizations for current user' })
  findAll(@Req() req: any) {
    return this.organizationsService.findAll(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  create(@Body() createOrgDto: CreateOrganizationDto, @Req() req: any) {
    return this.organizationsService.create(createOrgDto, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get organization by ID' })
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.organizationsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update organization' })
  update(@Param('id') id: string, @Body() updateOrgDto: UpdateOrganizationDto, @Req() req: any) {
    return this.organizationsService.update(id, updateOrgDto, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete organization' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.organizationsService.remove(id, req.user.id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add member to organization' })
  addMember(@Param('id') id: string, @Body() body: { email: string; role?: string }, @Req() req: any) {
    return this.organizationsService.addMember(id, body.email, body.role, req.user.id);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove member from organization' })
  removeMember(@Param('id') id: string, @Param('userId') userId: string, @Req() req: any) {
    return this.organizationsService.removeMember(id, userId, req.user.id);
  }
}
