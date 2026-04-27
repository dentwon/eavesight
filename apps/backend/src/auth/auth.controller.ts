import { Controller, Post, Body, Get, UseGuards, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE } from './auth-cookies.helper';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result: any = await this.authService.register(registerDto);
    // Account-enumeration mitigation may return a no-token "if available" stub
    // for an existing email. Only set cookies when real tokens are issued.
    if (result?.accessToken && result?.refreshToken) {
      setAuthCookies(res, result.accessToken, result.refreshToken);
    }
    return result;
  }

  @Post('login')
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);
    setAuthCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Begin Google OAuth flow (redirects to Google)' })
  async googleAuth() {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback — issues JWT tokens via httpOnly cookies' })
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const result = await this.authService.loginWithGoogleProfile(req.user);
    const frontendUrl =
      this.configService.get<string>('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000';
    setAuthCookies(res, result.accessToken, result.refreshToken);
    res.redirect(`${frontendUrl}/auth/oauth-complete`);
  }

  @Post('refresh')
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Req() req: Request,
    @Body() refreshTokenDto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Read from httpOnly cookie first (browser-issued); fall back to body
    // for non-browser clients. Cookie wins when both are present so a
    // stale body-borne token can't override a fresher cookie session.
    const cookieToken = (req as any)?.cookies?.[REFRESH_COOKIE];
    const refreshToken: string =
      (typeof cookieToken === 'string' && cookieToken) || refreshTokenDto?.refreshToken;
    if (!refreshToken) {
      throw new Error('No refresh token provided');
    }
    const result = await this.authService.refresh({ refreshToken });
    setAuthCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'User logout' })
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logout(req.user.id);
    clearAuthCookies(res);
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
