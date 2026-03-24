import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
    });

    return memberships.map((m: { organization: any }) => m.organization);
  }

  async create(createOrgDto: CreateOrganizationDto, userId: string) {
    const organization = await this.prisma.organization.create({
      data: {
        name: createOrgDto.name,
        plan: 'STARTER',
        members: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
      include: {
        members: {
          include: { user: true },
        },
      },
    });

    return organization;
  }

  async findOne(id: string, userId: string) {
    // Check if user is a member
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: id, userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    return this.prisma.organization.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: true },
        },
        _count: {
          select: { leads: true },
        },
      },
    });
  }

  async update(id: string, updateOrgDto: UpdateOrganizationDto, userId: string) {
    // Check if user is owner or admin
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: id, userId },
      },
    });

    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      throw new ForbiddenException('You do not have permission to update this organization');
    }

    return this.prisma.organization.update({
      where: { id },
      data: updateOrgDto,
    });
  }

  async remove(id: string, userId: string) {
    // Only owner can delete
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: id, userId },
      },
    });

    if (!membership || membership.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can delete this organization');
    }

    await this.prisma.organization.delete({ where: { id } });

    return { message: 'Organization deleted successfully' };
  }

  async addMember(orgId: string, email: string, role: string = 'MEMBER', userId: string) {
    // Check if user is owner or admin
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
    });

    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      throw new ForbiddenException('You do not have permission to add members');
    }

    // Find user by email
    const userToAdd = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!userToAdd) {
      throw new NotFoundException('User not found');
    }

    // Check if already a member
    const existingMembership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: userToAdd.id },
      },
    });

    if (existingMembership) {
      throw new ConflictException('User is already a member of this organization');
    }

    return this.prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: userToAdd.id,
        role: role as any,
      },
      include: { user: true, organization: true },
    });
  }

  async removeMember(orgId: string, userIdToRemove: string, userId: string) {
    // Check if user is owner or admin
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
    });

    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      throw new ForbiddenException('You do not have permission to remove members');
    }

    // Can't remove owner
    if (userIdToRemove === userId) {
      throw new ForbiddenException('You cannot remove yourself');
    }

    await this.prisma.organizationMember.delete({
      where: {
        organizationId_userId: { organizationId: orgId, userId: userIdToRemove },
      },
    });

    return { message: 'Member removed successfully' };
  }
}
