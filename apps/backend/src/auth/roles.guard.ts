import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, OrgMemberRole } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { ROLES_KEY, ORG_ROLES_KEY } from './roles.decorator';

/**
 * Enforces both system-level roles (User.role via @Roles) and tenant-scoped
 * roles (OrganizationMember.role via @OrgRoles). If either decorator is
 * present on the handler/controller, the request must satisfy it.
 *
 * Assumes JwtAuthGuard ran first and populated req.user with { id, role, orgId }.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredOrg = this.reflector.getAllAndOverride<OrgMemberRole[] | undefined>(ORG_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length && !requiredOrg?.length) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('Authenticated context required');

    if (required?.length) {
      if (!user.role || !required.includes(user.role)) {
        throw new ForbiddenException('Insufficient role');
      }
    }

    if (requiredOrg?.length) {
      if (!user.orgId) throw new ForbiddenException('Organization context required');
      const membership = await this.prisma.organizationMember.findFirst({
        where: { organizationId: user.orgId, userId: user.id },
        select: { role: true },
      });
      if (!membership || !requiredOrg.includes(membership.role)) {
        throw new ForbiddenException('Insufficient organization role');
      }
    }

    return true;
  }
}
