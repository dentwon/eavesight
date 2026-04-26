import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Prisma } from '@prisma/client';
import { GoogleOAuthProfile } from './google.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName, organizationName } = registerDto;

    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user and organization in a transaction
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
        },
      });

      // Create organization
      const org = await tx.organization.create({
        data: {
          name: organizationName || `${firstName || 'User'}'s Roofing`,
        },
      });

      // Add user to organization as owner
      await tx.organizationMember.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          role: 'OWNER',
        },
      });

      return { user, org };
    });

    // Generate tokens
    const tokens = await this.generateTokens(result.user.id);

    // Save session
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

    // Find user
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
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Get primary organization
    const orgId = user.organizationMemberships?.[0]?.organizationId || null;

    // Generate tokens
    const tokens = await this.generateTokens(user.id);

    // Save session
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

    // Find session
    const session = await this.prisma.session.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Delete old session
    await this.prisma.session.delete({
      where: { id: session.id },
    });

    // Generate new tokens
    const tokens = await this.generateTokens(session.user.id);

    // Save new session
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

  /**
   * OAuth (Google) login. Two paths:
   *  - existing user with this email → log them in (link Google to that account)
   *  - no existing user → create a new user + new org, no password set
   *
   * Until the schema migration that adds User.googleId, we link purely on email.
   * After migration, swap the lookup to googleId and fall back to email.
   */
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
      // First-time OAuth user — create user + org in one transaction.
      // Generate an un-knowable random passwordHash placeholder so the
      // password-login path can never authenticate this account. (After the
      // schema migration that makes passwordHash nullable, this becomes null.)
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
          data: {
            name: `${profile.firstName || 'New'}'s Roofing`,
          },
        });
        await tx.organizationMember.create({
          data: {
            userId: newUser.id,
            organizationId: org.id,
            role: 'OWNER',
          },
        });
        return { user: newUser, org };
      });
      user = { ...result.user, organizationMemberships: [{ organizationId: result.org.id, role: 'OWNER' as const, id: '', userId: result.user.id, createdAt: new Date() }] } as any;
      orgId = result.org.id;
    } else {
      orgId = user.organizationMemberships?.[0]?.organizationId || null;
      // Mark email verified now that Google has confirmed it.
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
    // Delete all sessions for user
    await this.prisma.session.deleteMany({
      where: { userId },
    });

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
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
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
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.session.upsert({
      where: { token: refreshToken },
      update: { userId, expiresAt },
      create: {
        userId,
        token: refreshToken,
        expiresAt,
      },
    });
  }
}
