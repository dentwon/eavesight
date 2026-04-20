import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), (req: any) => (req?.query?.token as string) ?? null]),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET') || 'default-secret-change-me',
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        organizationMemberships: {
          select: {
            organizationId: true,
            role: true,
          },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Attach primary organization ID
    const orgId = user.organizationMemberships?.[0]?.organizationId || null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      orgId,
    };
  }
}
