import { IsEmail, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  // Cap the password size before bcrypt — bcrypt is O(n) on input length and
  // a 10MB password would let an unauthenticated attacker burn CPU on every
  // /login request. 100 chars is generous for any legitimate password.
  @MaxLength(100)
  password: string;
}
