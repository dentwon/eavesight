import { IsString, IsOptional, IsNumber, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class SearchPropertiesDto {
  @ApiPropertyOptional({ example: 'TX' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: 'Dallas' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: '75201' })
  @IsString()
  @IsOptional()
  zip?: string;

  @ApiPropertyOptional({ example: 1980 })
  @IsNumber()
  @IsOptional()
  @Min(1800)
  @Transform(({ value }) => parseInt(value))
  minYearBuilt?: number;

  @ApiPropertyOptional({ example: 2010 })
  @IsNumber()
  @IsOptional()
  @Min(1800)
  @Transform(({ value }) => parseInt(value))
  maxYearBuilt?: number;

  @ApiPropertyOptional({ example: 32.7767 })
  @IsNumber()
  @IsOptional()
  lat?: number;

  @ApiPropertyOptional({ example: -96.7970 })
  @IsNumber()
  @IsOptional()
  lon?: number;

  @ApiPropertyOptional({ example: 0.1, description: 'Radius in degrees for lat/lon search' })
  @IsNumber()
  @IsOptional()
  radius?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number;
}
