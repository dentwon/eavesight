import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';

export interface GoogleOAuthProfile {
  googleId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_OAUTH_CLIENT_ID') || '';
    const clientSecret = configService.get<string>('GOOGLE_OAUTH_CLIENT_SECRET') || '';
    const apiUrl = configService.get<string>('NEXT_PUBLIC_API_URL') || 'http://localhost:4000/api';
    super({
      clientID,
      clientSecret,
      callbackURL: `${apiUrl}/auth/google/callback`,
      scope: ['email', 'profile'],
      // CSRF-protect the OAuth dance. passport-google-oauth20 generates a
      // session-keyed state value on /auth/google and verifies it on
      // /auth/google/callback. Without this, an attacker can complete OAuth
      // in their browser and trick a victim into landing on the callback,
      // signing the victim into the attacker's account.
      state: true,
    });
    if (!clientID || !clientSecret) {
      this.logger.warn(
        'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set — /auth/google routes will fail until configured.',
      );
    }
  }

  async validate(_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      return done(new Error('Google account did not return an email'), undefined);
    }
    const oauthProfile: GoogleOAuthProfile = {
      googleId: profile.id,
      email,
      firstName: profile.name?.givenName ?? null,
      lastName: profile.name?.familyName ?? null,
      avatar: profile.photos?.[0]?.value ?? null,
    };
    done(null, oauthProfile);
  }
}
