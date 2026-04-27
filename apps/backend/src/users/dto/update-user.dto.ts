import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

/**
 * Self-service profile update payload. Mutable fields are deliberately
 * narrow — `email`, `passwordHash`, `emailVerified`, `stripeCustomerId`,
 * `orgId` are NOT part of this DTO. Email change requires a separate
 * verification flow; password change has its own endpoint.
 *
 * `role` is accepted here but the service rejects mutation by anyone
 * other than SUPER_ADMIN, and never on self.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John' })
  @IsString()
  @IsOptional()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsString()
  @IsOptional()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ enum: UserRole, description: 'SUPER_ADMIN only; never on self' })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;
}
