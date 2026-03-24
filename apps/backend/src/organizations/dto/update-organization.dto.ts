import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Plan } from '@prisma/client';

export class UpdateOrganizationDto {
  @ApiPropertyOptional({ example: 'ABC Roofing LLC' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: Plan })
  @IsEnum(Plan)
  @IsOptional()
  plan?: Plan;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  logo?: string;

  @ApiPropertyOptional({ example: 'https://abcroofing.com' })
  @IsString()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional({ example: '555-123-4567' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Dallas' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'TX' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: '75201' })
  @IsString()
  @IsOptional()
  zip?: string;
}
