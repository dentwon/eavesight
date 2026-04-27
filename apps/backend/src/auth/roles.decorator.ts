import { SetMetadata } from '@nestjs/common';
import { UserRole, OrgMemberRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const ORG_ROLES_KEY = 'orgRoles';

/**
 * Restrict an endpoint to one or more system-level roles (User.role).
 * Use for cross-org administrative endpoints.
 *   @Roles('ADMIN', 'SUPER_ADMIN')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Restrict an endpoint to one or more org-member roles (OrganizationMember.role).
 * Use for tenant-scoped administrative endpoints (billing, member management).
 * Caller must have an OrganizationMember row in the org with at least one of the roles.
 *   @OrgRoles('OWNER', 'ADMIN')
 */
export const OrgRoles = (...roles: OrgMemberRole[]) => SetMetadata(ORG_ROLES_KEY, roles);
