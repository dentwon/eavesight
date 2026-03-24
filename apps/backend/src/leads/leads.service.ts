import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(orgId: string, query: {
    status?: string;
    assigneeId?: string;
    limit?: number;
    offset?: number;
  }) {
    const { status, assigneeId, limit = 50, offset = 0 } = query;

    const where: any = { orgId };
    if (status) where.status = status;
    if (assigneeId) where.assigneeId = assigneeId;

    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          property: {
            include: {
              propertyStorms: {
                include: { stormEvent: true },
                take: 5,
              },
            },
          },
          assignee: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      data: leads,
      meta: { total, limit, offset, hasMore: offset + leads.length < total },
    };
  }

  async findOne(id: string, orgId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        property: {
          include: {
            propertyStorms: {
              include: { stormEvent: true },
            },
          },
        },
        assignee: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        organization: {
          select: { id: true, name: true },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (lead.orgId !== orgId) {
      throw new ForbiddenException('Access denied');
    }

    return lead;
  }

  async create(orgId: string, createLeadDto: CreateLeadDto) {
    const { propertyId, firstName, lastName, email, phone, source, notes, priority } = createLeadDto;

    const lead = await this.prisma.lead.create({
      data: {
        orgId,
        propertyId,
        firstName,
        lastName,
        email,
        phone,
        source,
        notes,
        priority: priority || 'MEDIUM',
        status: 'NEW',
      },
      include: {
        property: true,
      },
    });

    return lead;
  }

  async update(id: string, orgId: string, updateLeadDto: UpdateLeadDto) {
    const lead = await this.findOne(id, orgId);

    return this.prisma.lead.update({
      where: { id: lead.id },
      data: updateLeadDto,
      include: {
        property: true,
        assignee: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async updateStatus(id: string, orgId: string, status: string) {
    const lead = await this.findOne(id, orgId);

    const updateData: any = { status };

    switch (status) {
      case 'CONTACTED':
        updateData.contactedAt = new Date();
        break;
      case 'QUOTED':
        updateData.quotedAt = new Date();
        break;
      case 'WON':
        updateData.convertedAt = new Date();
        break;
      case 'LOST':
        updateData.lostAt = new Date();
        break;
    }

    return this.prisma.lead.update({
      where: { id: lead.id },
      data: updateData,
    });
  }

  async assign(id: string, orgId: string, assigneeId: string) {
    const lead = await this.findOne(id, orgId);

    return this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        assigneeId,
        assignedAt: new Date(),
      },
    });
  }

  async delete(id: string, orgId: string) {
    const lead = await this.findOne(id, orgId);

    await this.prisma.lead.delete({
      where: { id: lead.id },
    });

    return { success: true };
  }

  async bulkCreate(orgId: string, leads: CreateLeadDto[]) {
    const result = await this.prisma.lead.createMany({
      data: leads.map((lead) => ({
        ...lead,
        orgId,
        status: 'NEW',
        priority: lead.priority || 'MEDIUM',
      })),
    });

    return { count: result.count };
  }

  async getStats(orgId: string) {
    const [
      total,
      newCount,
      contactedCount,
      quotedCount,
      wonCount,
      lostCount,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { orgId } }),
      this.prisma.lead.count({ where: { orgId, status: 'NEW' } }),
      this.prisma.lead.count({ where: { orgId, status: 'CONTACTED' } }),
      this.prisma.lead.count({ where: { orgId, status: 'QUOTED' } }),
      this.prisma.lead.count({ where: { orgId, status: 'WON' } }),
      this.prisma.lead.count({ where: { orgId, status: 'LOST' } }),
    ]);

    const conversionRate = total > 0 ? Math.round((wonCount / total) * 100) : 0;

    return {
      total,
      byStatus: { new: newCount, contacted: contactedCount, quoted: quotedCount, won: wonCount, lost: lostCount },
      conversionRate,
    };
  }
}
