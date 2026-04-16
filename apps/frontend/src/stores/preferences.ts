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

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      appTheme: 'dark',
      mapTheme: 'dark',
      sidebarExpanded: true,
      setAppTheme: (theme) => set({ appTheme: theme }),
      setMapTheme: (theme) => set({ mapTheme: theme }),
      setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),
    }),
    { name: 'preferences-storage' }
  )
);