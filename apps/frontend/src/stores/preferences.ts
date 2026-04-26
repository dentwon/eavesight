import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type MapTheme = 'dark' | 'light' | 'satellite';
type AppTheme = 'dark' | 'light';

interface PreferencesState {
  appTheme: AppTheme;
  mapTheme: MapTheme;
  sidebarExpanded: boolean;
  setAppTheme: (theme: AppTheme) => void;
  setMapTheme: (theme: MapTheme) => void;
  setSidebarExpanded: (expanded: boolean) => void;
}

// Keeps the <html> element's theme class in sync with `appTheme`. Tailwind's
// `darkMode: 'class'` strategy and the CSS token sets in globals.css both key
// off this class, so every call to `setAppTheme` must update it. The initial
// value is applied by the inline script in `app/layout.tsx` to avoid FOUC on
// first paint; this function handles every subsequent toggle.
function syncHtmlThemeClass(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(theme);
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      appTheme: 'dark',
      mapTheme: 'dark',
      sidebarExpanded: true,
      setAppTheme: (theme) => {
        syncHtmlThemeClass(theme);
        set({ appTheme: theme });
      },
      setMapTheme: (theme) => set({ mapTheme: theme }),
      setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),
    }),
    {
      name: 'preferences-storage',
      // After zustand hydrates persisted state on page load, re-apply the
      // class in case the user cleared the class manually or the pre-hydration
      // script raced with anything else. Idempotent.
      onRehydrateStorage: () => (state) => {
        if (state?.appTheme) syncHtmlThemeClass(state.appTheme);
      },
    }
  )
);