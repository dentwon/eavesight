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
    const { status, assigneeId } = query;
    const limit = parseInt(query.limit as any) || 50;
    const offset = parseInt(query.offset as any) || 0;

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

    // Defense-in-depth: even if the controller is org-scoped, an admin
    // shouldn't be able to assign a lead to a user from a different org.
    const membership = await this.prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId: assigneeId },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException('Assignee must be a member of this organization');
    }

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
    if (!Array.isArray(leads) || leads.length === 0) return { count: 0 };
    if (leads.length > 1000) {
      throw new ForbiddenException('Bulk create limited to 1000 leads per call');
    }

    // Validate cross-org references up front: every propertyId must exist,
    // every assigneeId must be a member of this org. We deliberately do
    // NOT trust spread `...lead` here — only whitelist-known fields are
    // forwarded, so client-supplied `score`, `convertedAt`, `orgId`, etc.
    // can't override our values.
    const propertyIds = Array.from(
      new Set(leads.map((l) => (l as any).propertyId).filter((id): id is string => !!id)),
    );
    if (propertyIds.length) {
      const existing = await this.prisma.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true },
      });
      if (existing.length !== propertyIds.length) {
        throw new ForbiddenException('One or more propertyIds do not exist');
      }
    }

    const assigneeIds = Array.from(
      new Set(leads.map((l) => (l as any).assigneeId).filter((id): id is string => !!id)),
    );
    if (assigneeIds.length) {
      const memberships = await this.prisma.organizationMember.findMany({
        where: { organizationId: orgId, userId: { in: assigneeIds } },
        select: { userId: true },
      });
      if (memberships.length !== assigneeIds.length) {
        throw new ForbiddenException('One or more assigneeIds do not belong to this organization');
      }
    }

    const result = await this.prisma.lead.createMany({
      data: leads.map((lead: any) => ({
        orgId,
        propertyId: lead.propertyId ?? null,
        parcelId: lead.parcelId ?? null,
        firstName: lead.firstName ?? null,
        lastName: lead.lastName ?? null,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        source: lead.source ?? null,
        notes: lead.notes ?? null,
        tags: Array.isArray(lead.tags) ? lead.tags : [],
        assigneeId: lead.assigneeId ?? null,
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
