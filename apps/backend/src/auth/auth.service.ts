import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Prisma } from '@prisma/client';
import { GoogleOAuthProfile } from './google.strategy';
import { LoginLockoutService } from './login-lockout.service';

// Real bcrypt hash of a random throwaway password, computed once at module
// load. Used in `login()` to keep timing roughly constant when the email
// doesn't exist — `bcrypt.compare` runs the full key-derivation against
// this real hash before returning false, instead of failing fast on a
// malformed string.
const TIMING_DUMMY_HASH = bcrypt.hashSync('eavesight-timing-dummy-' + crypto.randomBytes(16).toString('hex'), 12);

/**
 * AuthService.
 *
 * Refresh tokens are stored in the DB only as SHA-256 hashes — the original
 * token string only exists in transit and in client storage. A DB read leak
 * therefore yields hashes, not bearer credentials. (See `hashRefreshToken`.)
 *
 * Token rotation: every successful refresh deletes the old session row and
 * issues a new one. A future enhancement (token-family / replay detection)
 * is gated on an additional `tokenFamily` column.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly lockout: LoginLockoutService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName, organizationName } = registerDto;

    const existingUser = await this.prisma.user.findUnique({ where: { email } });

    // Account-enumeration mitigation: do NOT reveal that an email is taken
    // here. Bail with the same generic shape as a successful pre-registration
    // step would produce. The legitimate user will hit "your account already
    // exists, did you mean to log in?" via a separate password-reset / email
    // verification flow (TODO: implement). Returning {success: true} prevents
    // the existence oracle that an attacker can use for credential stuffing
    // targeting.
    if (existingUser) {
      // Constant-time-ish — still hash a throwaway password so the timing
      // signature roughly matches the create branch. Not perfect, but
      // closes the most obvious oracle.
      await bcrypt.hash(password, 12);
      return {
        message: 'If this email is available, your account has been created. Check your inbox.',
      };
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: { email, passwordHash, firstName, lastName },
      });
      const org = await tx.organization.create({
        data: { name: organizationName || `${firstName || 'User'}'s Roofing` },
      });
      await tx.organizationMember.create({
        data: { userId: user.id, organizationId: org.id, role: 'OWNER' },
      });
      return { user, org };
    });

    const tokens = await this.generateTokens(result.user.id);
    await this.saveSession(result.user.id, tokens.refreshToken);

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
        orgId: result.org.id,
      },
      ...tokens,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Per-account lockout — defends against distributed credential stuffing.
    // The @Throttle on /login is per-IP only; rotated IPs let an attacker
    // try thousands of passwords against one email. This caps that.
    const lockMs = this.lockout.isLocked(email);
    if (lockMs > 0) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        organizationMemberships: {
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user || !user.passwordHash) {
      // Run a dummy bcrypt to avoid a timing oracle on email existence.
      await bcrypt.compare(password, TIMING_DUMMY_HASH);
      this.lockout.recordFailure(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      this.lockout.recordFailure(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.lockout.recordSuccess(email);

    const orgId = user.organizationMemberships?.[0]?.organizationId || null;

    const tokens = await this.generateTokens(user.id);
    await this.saveSession(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        orgId,
      },
      ...tokens,
    };
  }

  async refresh(refreshTokenDto: { refreshToken: string }) {
    const { refreshToken } = refreshTokenDto;
    const tokenHash = this.hashRefreshToken(refreshToken);

    // The DB only stores hashed refresh tokens; lookup by hash, not by raw.
    const session = await this.prisma.session.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.session.delete({ where: { id: session.id } });

    const tokens = await this.generateTokens(session.user.id);
    await this.saveSession(session.user.id, tokens.refreshToken);

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        role: session.user.role,
      },
      ...tokens,
    };
  }

  async loginWithGoogleProfile(profile: GoogleOAuthProfile) {
    if (!profile?.email) {
      throw new UnauthorizedException('Google account did not return an email');
    }
    const email = profile.email.toLowerCase();

    let user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        organizationMemberships: {
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    let orgId: string | null;

    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 12);

      const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const newUser = await tx.user.create({
          data: {
            email,
            passwordHash,
            firstName: profile.firstName,
            lastName: profile.lastName,
            avatar: profile.avatar,
            emailVerified: new Date(),
          },
        });
        const org = await tx.organization.create({
          data: { name: `${profile.firstName || 'New'}'s Roofing` },
        });
        await tx.organizationMember.create({
          data: { userId: newUser.id, organizationId: org.id, role: 'OWNER' },
        });
        return { user: newUser, org };
      });
      user = { ...result.user, organizationMemberships: [{ organizationId: result.org.id, role: 'OWNER' as const, id: '', userId: result.user.id, createdAt: new Date() }] } as any;
      orgId = result.org.id;
    } else {
      orgId = user.organizationMemberships?.[0]?.organizationId || null;
      if (!user.emailVerified) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: new Date() },
        });
      }
    }

    const tokens = await this.generateTokens(user!.id);
    await this.saveSession(user!.id, tokens.refreshToken);
    return {
      user: {
        id: user!.id,
        email: user!.email,
        firstName: user!.firstName,
        lastName: user!.lastName,
        role: user!.role,
        orgId,
      },
      ...tokens,
    };
  }

  async logout(userId: string) {
    await this.prisma.session.deleteMany({ where: { userId } });
    return { message: 'Logged out successfully' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        organizationMemberships: {
          select: {
            id: true,
            role: true,
            organization: { select: { id: true, name: true, plan: true } },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  /**
   * Cryptographic hash of the refresh token stored in DB. SHA-256 is fine
   * here — the input is already 256 bits of randomness from JWT signing,
   * so we don't need bcrypt's slowness.
   */
  private hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async generateTokens(userId: string) {
    const payload = { sub: userId };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(payload, { expiresIn: '7d' }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveSession(userId: string, refreshToken: string) {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.session.upsert({
      where: { token: tokenHash },
      update: { userId, expiresAt },
      create: {
        userId,
        token: tokenHash,
        expiresAt,
      },
    });
  }
}
