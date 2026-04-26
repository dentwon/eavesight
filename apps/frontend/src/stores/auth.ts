import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect, useState } from 'react';

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  orgId?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string, refreshToken?: string) => void;
  updateUser: (user: Partial<User>) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      setAuth: (user, token, refreshToken) => {
        set({ user, token, refreshToken: refreshToken || null, isAuthenticated: true });
        if (typeof window !== 'undefined') {
          localStorage.setItem('token', token);
          if (refreshToken) {
            localStorage.setItem('refreshToken', refreshToken);
          }
        }
      },
      updateUser: (userData) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        }));
      },
      logout: () => {
        set({ user: null, token: null, refreshToken: null, isAuthenticated: false });
        if (typeof window !== 'undefined') {
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

/**
 * Returns true once the zustand persist middleware has finished reading
 * `auth-storage` from localStorage and populated the store.
 *
 * Why this exists: Next.js 14 App Router renders client components against
 * the store's default state first, then zustand persist rehydrates a tick
 * later. Without gating on hydration, a logged-in user hitting the dashboard
 * cold sees `isAuthenticated === false` on the first render and any
 * redirect-to-login effect fires before the real state arrives. End result:
 * every hard refresh / PM2 reload bounces them to /login.
 *
 * Call from layouts / route guards — show a neutral loading state (or
 * nothing) while this is false, then do your auth check once it flips true.
 * Session state already survives refreshes via localStorage — this hook
 * just makes React see it in time.
 */
export function useAuthHasHydrated(): boolean {
  const [hydrated, setHydrated] = useState<boolean>(
    // On the client this is synchronously `true` after persist has finished
    // its first pass; on the server it's always `false`. Reading it here
    // means a tab that's been open long enough for hydration to complete
    // skips the useEffect round-trip entirely.
    () => (typeof window !== 'undefined' ? useAuthStore.persist.hasHydrated() : false),
  );
  useEffect(() => {
    // Subscribe to the end-of-hydration event so the first render after a
    // cold load also flips. Idempotent — re-setting `true` is a no-op.
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    // Safety catch for the edge case where hasHydrated() was false during
    // `useState` init but became true between that and this effect firing.
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  return hydrated;
}
