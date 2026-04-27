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
  isAuthenticated: boolean;
  // Tokens are no longer stored client-side. The backend issues httpOnly
  // cookies (eavesight_access / eavesight_refresh) on /auth/login,
  // /auth/refresh, /auth/google/callback. Cookies are sent automatically
  // with every same-origin /api/* request. setAuth now only takes the
  // user payload — the response body's accessToken/refreshToken are
  // ignored by the frontend.
  setAuth: (user: User) => void;
  updateUser: (user: Partial<User>) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      setAuth: (user) => {
        set({ user, isAuthenticated: true });
      },
      updateUser: (userData) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        }));
      },
      logout: () => {
        set({ user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'auth-storage',
      // Only persist non-sensitive identity fields. Tokens are NEVER
      // serialized to localStorage — they live only in httpOnly cookies
      // managed by the backend, where XSS cannot read them.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);

/**
 * Returns true once the zustand persist middleware has finished reading
 * `auth-storage` from localStorage and populated the store.
 *
 * Why this exists: Next.js 14 App Router renders client components against
 * the store's default state first, then zustand persist rehydrates a tick
 * later. Without gating on hydration, a logged-in user hitting the dashboard
 * cold sees `isAuthenticated === false` on the first render and any
 * redirect-to-login effect fires before the real state arrives.
 */
export function useAuthHasHydrated(): boolean {
  const [hydrated, setHydrated] = useState<boolean>(
    () => (typeof window !== 'undefined' ? useAuthStore.persist.hasHydrated() : false),
  );
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  return hydrated;
}
