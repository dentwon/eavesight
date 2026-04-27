'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import api from '@/lib/api';

/**
 * OAuth completion page. The backend's /auth/google/callback sets
 * `eavesight_access` and `eavesight_refresh` httpOnly cookies before
 * redirecting here. We just call /auth/me (the cookie is sent automatically
 * via withCredentials) to populate the auth store, then redirect.
 *
 * No token parsing from the URL fragment — that flow exposed tokens to
 * any in-page JS, browser extensions, and Referer leaks. Cookies are
 * inaccessible to JS.
 */
export default function OAuthCompletePage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const finish = async () => {
      try {
        const res = await api.get('/auth/me');
        const me = res.data;
        const orgId = me?.organizationMemberships?.[0]?.organizationId;
        setAuth({
          id: me.id,
          email: me.email,
          firstName: me.firstName,
          lastName: me.lastName,
          role: me.role,
          orgId,
        });
        router.replace('/dashboard');
      } catch (err: any) {
        setError(err?.response?.data?.message || 'Failed to complete sign-in');
      }
    };
    finish();
  }, [router, setAuth]);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-300">
      {error ? (
        <div className="max-w-md text-center">
          <p className="text-red-400 font-semibold mb-2">Sign-in failed</p>
          <p className="text-sm">{error}</p>
          <a href="/login" className="mt-4 inline-block text-blue-400 hover:text-blue-300 text-sm">Back to sign in</a>
        </div>
      ) : (
        <p className="text-sm">Finishing sign-in…</p>
      )}
    </div>
  );
}
