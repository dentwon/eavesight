'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import api from '@/lib/api';

/**
 * OAuth completion page. The backend's /auth/google/callback redirects here
 * with `accessToken` + `refreshToken` in the URL fragment (so they never hit
 * server access logs). We pick them up, fetch the user profile, save to the
 * auth store, then redirect to the dashboard.
 */
export default function OAuthCompletePage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const finish = async () => {
      const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('accessToken');
      const refreshToken = params.get('refreshToken');
      if (!accessToken || !refreshToken) {
        setError('OAuth response was missing tokens. Please try signing in again.');
        return;
      }
      try {
        const res = await api.get('/auth/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const me = res.data;
        const orgId = me?.organizationMemberships?.[0]?.organizationId;
        setAuth(
          {
            id: me.id,
            email: me.email,
            firstName: me.firstName,
            lastName: me.lastName,
            role: me.role,
            orgId,
          },
          accessToken,
          refreshToken,
        );
        // Clear the fragment so refresh doesn't re-process tokens
        window.history.replaceState(null, '', '/auth/oauth-complete');
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
