import { IsString, IsOptional, MaxLength, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Self-service organization update payload.
 *
 * `plan`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus`,
 * `currentPeriodEnd`, `trialEndsAt` are NOT writable by users — they only
 * change as a result of Stripe webhook events. An ADMIN previously could
 * `PATCH /api/orgs/:id { "plan": "ENTERPRISE" }` to grant their own org
 * any plan for free; that path is now closed by removing the field.
 */
export class UpdateOrganizationDto {
  @ApiPropertyOptional({ example: 'ABC Roofing LLC' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  logo?: string;

  @ApiPropertyOptional({ example: 'https://abcroofing.com' })
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  website?: string;

  @ApiPropertyOptional({ example: '555-123-4567' })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: 'Dallas' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'TX' })
  @IsString()
  @IsOptional()
  @MaxLength(2)
  state?: string;

  @ApiPropertyOptional({ example: '75201' })
  @IsString()
  @IsOptional()
  @MaxLength(10)
  zip?: string;
}
