import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'ABC Roofing LLC' })
  @IsString()
  @MaxLength(255)
  name: string;

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
