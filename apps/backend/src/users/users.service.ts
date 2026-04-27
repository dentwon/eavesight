import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  emailVerified: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({ select: PUBLIC_USER_SELECT });
  }

  async findOne(id: string, currentUser: { id: string; role: string }) {
    if (
      currentUser.id !== id &&
      currentUser.role !== 'ADMIN' &&
      currentUser.role !== 'SUPER_ADMIN'
    ) {
      throw new ForbiddenException('You can only view your own profile');
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...PUBLIC_USER_SELECT,
        organizationMemberships: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            organization: { select: { id: true, name: true, plan: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Self-service profile update. Server-side whitelist of writable fields —
   * never trust the request body to set role, passwordHash, emailVerified,
   * stripeCustomerId, etc. Admin role changes are routed through a separate
   * admin-only endpoint (TODO).
   */
  async update(id: string, dto: UpdateUserDto, currentUser: { id: string; role: string }) {
    const isSelf = currentUser.id === id;
    const isAdmin = currentUser.role === 'ADMIN' || currentUser.role === 'SUPER_ADMIN';

    if (!isSelf && !isAdmin) {
      throw new ForbiddenException('You can only update your own profile');
    }

    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;

    // Email change disabled here — should require re-verification (see future
    // ChangeEmailDto + verification token flow). Silently ignored rather than
    // 400 to keep self-service forms forgiving.

    // Role mutation: SUPER_ADMIN only, and never on self.
    if (dto.role !== undefined) {
      if (currentUser.role !== 'SUPER_ADMIN' || isSelf) {
        throw new ForbiddenException('Only SUPER_ADMIN may change roles, and not on self');
      }
      data.role = dto.role;
    }

    if (Object.keys(data).length === 0) {
      const existing = await this.prisma.user.findUnique({
        where: { id },
        select: PUBLIC_USER_SELECT,
      });
      if (!existing) throw new NotFoundException('User not found');
      return existing;
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: PUBLIC_USER_SELECT,
      });
    } catch (err: any) {
      if (err?.code === 'P2025') throw new NotFoundException('User not found');
      throw err;
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === 'P2025') throw new NotFoundException('User not found');
      throw err;
    }
    return { message: 'User deleted successfully', userId: id };
  }
}
