import { IsString, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LookupPropertyDto {
  @ApiProperty({ example: '123 Main St' })
  @IsString()
  @MaxLength(255)
  address: string;

  @ApiPropertyOptional({ example: 'Apt 4' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  address2?: string;

  @ApiProperty({ example: 'Dallas' })
  @IsString()
  @MaxLength(100)
  city: string;

  @ApiProperty({ example: 'TX' })
  @IsString()
  @MaxLength(2)
  state: string;

  @ApiProperty({ example: '75201' })
  @IsString()
  @MaxLength(10)
  zip: string;
}
