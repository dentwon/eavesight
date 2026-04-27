import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { LoginLockoutService } from './login-lockout.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable must be set');
        }
        if (secret.length < 32) {
          throw new Error('JWT_SECRET must be at least 32 characters');
        }
        return {
          secret,
          // Pin signing AND verification to HS256 to defeat algorithm-confusion
          // attacks (e.g. an attacker submitting `alg: "none"` or RS256-with-
          // public-key-as-HS-secret tokens).
          signOptions: {
            algorithm: 'HS256',
            expiresIn: configService.get('JWT_EXPIRES_IN') || '15m',
            issuer: 'eavesight',
            audience: 'eavesight-api',
          },
          verifyOptions: {
            algorithms: ['HS256'],
            issuer: 'eavesight',
            audience: 'eavesight-api',
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, LoginLockoutService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
