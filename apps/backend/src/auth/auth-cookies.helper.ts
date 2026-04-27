import type { CookieOptions, Response } from 'express';

/**
 * Cookie names used for httpOnly auth. Centralized so logout/clear stays
 * in lockstep with /login, /refresh, /google/callback.
 */
export const ACCESS_COOKIE = 'eavesight_access';
export const REFRESH_COOKIE = 'eavesight_refresh';

const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // 15 min
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function baseCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    domain: isProd ? '.eavesight.com' : undefined,
    path: '/',
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  const base = baseCookieOptions();
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, maxAge: ACCESS_MAX_AGE_MS });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, maxAge: REFRESH_MAX_AGE_MS });
}

export function clearAuthCookies(res: Response): void {
  const base = baseCookieOptions();
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}
