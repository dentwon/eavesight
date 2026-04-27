import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma.service';

/**
 * Extract the access JWT from either the `eavesight_access` httpOnly cookie
 * (preferred — not exfil-able via XSS) OR the standard `Authorization: Bearer …`
 * header (for non-browser clients). Cookie takes precedence when both are
 * present so a browser with a stale localStorage token doesn't silently
 * outvote the live cookie.
 */
function extractFromRequest(req: Request): string | null {
  const cookieToken = (req as any)?.cookies?.eavesight_access;
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;
  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable must be set');
    }
    super({
      jwtFromRequest: extractFromRequest,
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
      issuer: 'eavesight',
      audience: 'eavesight-api',
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
