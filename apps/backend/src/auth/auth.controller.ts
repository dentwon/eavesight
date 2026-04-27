import { Controller, Post, Body, Get, UseGuards, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Begin Google OAuth flow (redirects to Google)' })
  async googleAuth() {
    // Passport handles redirect to Google's consent screen.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback — issues our JWT tokens via httpOnly cookies' })
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const result = await this.authService.loginWithGoogleProfile(req.user);
    const frontendUrl =
      this.configService.get<string>('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000';

    // Tokens go back as httpOnly cookies (NOT in the URL fragment) — fragment
    // delivery exposes tokens to any in-page JS, browser extensions, and to
    // Referer leaks if the destination page loads cross-origin resources
    // before clearing the hash. JS cannot read httpOnly cookies, which means
    // an XSS bug doesn't immediately exfiltrate session tokens.
    const isProd = process.env.NODE_ENV === 'production';
    const cookieDomain = isProd ? '.eavesight.com' : undefined;

    res.cookie('eavesight_access', result.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      domain: cookieDomain,
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie('eavesight_refresh', result.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      domain: cookieDomain,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.redirect(`${frontendUrl}/auth/oauth-complete`);
  }

  @Post('refresh')
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refresh(refreshTokenDto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'User logout' })
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logout(req.user.id);
    const isProd = process.env.NODE_ENV === 'production';
    const cookieDomain = isProd ? '.eavesight.com' : undefined;
    res.clearCookie('eavesight_access', { domain: cookieDomain, path: '/' });
    res.clearCookie('eavesight_refresh', { domain: cookieDomain, path: '/' });
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user' })
  async me(@Req() req: any) {
    return this.authService.me(req.user.id);
  }
}
