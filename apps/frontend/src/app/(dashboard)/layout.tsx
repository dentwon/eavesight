'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Home,
  Layers,
  Users,
  Map as MapIcon,
  AlertTriangle,
  Trophy,
  BarChart3,
  Settings,
  LogOut,
  Moon,
  Sun,
  Plus,
  MoreHorizontal,
} from 'lucide-react';
import { useAuthStore, useAuthHasHydrated } from '@/stores/auth';
import { usePreferencesStore } from '@/stores/preferences';
import { Logo } from '@/components/Logo';
import { LiveAlertBanner } from '@/components/LiveAlertBanner';
import { MobileMoreSheet } from '@/components/MobileMoreSheet';
import { QuickCaptureSheet } from '@/components/QuickCaptureSheet';
import { useStormAlerts } from '@/hooks/useStormAlerts';
import { cn } from '@/lib/utils';

// Two nav lists — desktop sidebar gets the full 9-destination app,
// mobile bottom bar gets only the 4 field-rep essentials + a center FAB
// + a "More" sheet for everything else.
const desktopNavItems = [
  { href: '/dashboard', label: 'Home', Icon: Home },
  { href: '/dashboard/pipeline', label: 'Pipeline', Icon: Layers },
  { href: '/dashboard/prospects', label: 'Prospects', Icon: Users },
  { href: '/dashboard/leads', label: 'Leads', Icon: Users },
  { href: '/dashboard/map', label: 'Map', Icon: MapIcon },
  { href: '/dashboard/alerts', label: 'Alerts', Icon: AlertTriangle },
  { href: '/dashboard/team', label: 'Team', Icon: Trophy },
  { href: '/dashboard/analytics', label: 'Analytics', Icon: BarChart3 },
  { href: '/dashboard/settings', label: 'Settings', Icon: Settings },
] as const;

type MobileTabItem =
  | {
      href: string;
      label: string;
      Icon: React.ComponentType<{ className?: string }>;
      showAlertBadge?: boolean;
    }
  | { kind: 'more'; label: string; Icon: React.ComponentType<{ className?: string }> };

const mobileNavItems: readonly MobileTabItem[] = [
  { href: '/dashboard/map', label: 'Map', Icon: MapIcon },
  { href: '/dashboard/leads', label: 'Leads', Icon: Users },
  // FAB renders between these two halves
  { href: '/dashboard/alerts', label: 'Alerts', Icon: AlertTriangle, showAlertBadge: true },
  { kind: 'more', label: 'More', Icon: MoreHorizontal },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuthStore();
  // Zustand persist is async in Next.js 14 App Router — first render sees
  // the default (isAuthenticated=false) before localStorage hits the store.
  // Gating the redirect on hydration is what keeps logged-in users from
  // bouncing back to /login on every hard refresh or PM2 reload.
  const authHydrated = useAuthHasHydrated();
  const sidebarExpanded = usePreferencesStore((s) => s.sidebarExpanded);
  const setSidebarExpanded = usePreferencesStore((s) => s.setSidebarExpanded);
  const appTheme = usePreferencesStore((s) => s.appTheme);
  const setAppTheme = usePreferencesStore((s) => s.setAppTheme);

  const [moreOpen, setMoreOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  const { activeAlerts, hasExtreme } = useStormAlerts();
  const alertCount = activeAlerts.length;

  useEffect(() => {
    // Wait for the persisted auth state to land before deciding anything —
    // otherwise we'd redirect a logged-in user to /login on the first render
    // and only realize our mistake after the localStorage read resolved.
    if (!authHydrated) return;
    if (!isAuthenticated) router.push('/login');
  }, [authHydrated, isAuthenticated, router]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };
  const toggleSidebar = () => setSidebarExpanded(!sidebarExpanded);
  const toggleTheme = () => {
    const next = appTheme === 'dark' ? 'light' : 'dark';
    setAppTheme(next);
    if (next === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
  };

  // Render nothing until hydration completes — otherwise the first paint
  // shows the sidebar, then flickers to /login as the useEffect above fires.
  // Once hydrated, show the dashboard if authenticated; otherwise let the
  // useEffect redirect take over and render nothing in the meantime.
  if (!authHydrated || !isAuthenticated) return null;

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
  const sidebarWidth = sidebarExpanded ? '180px' : '64px';

  return (
    <div className="h-screen bg-[hsl(var(--background))] flex flex-col md:flex-row overflow-hidden">
      {/* Mobile top header — compact */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] z-20">
        <Link href="/dashboard/map" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground">
            <Logo className="w-full h-full" />
          </div>
          <span className="text-base font-semibold">Eavesight</span>
        </Link>
        <div className="flex items-center gap-2">
          {alertCount > 0 && (
            <Link
              href="/dashboard/alerts"
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold',
                hasExtreme
                  ? 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] animate-alert-pulse'
                  : 'bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]',
              )}
              aria-label={`${alertCount} active alerts`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {alertCount}
            </Link>
          )}
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="Open account menu"
            className="w-8 h-8 bg-[hsl(var(--muted))] rounded-full flex items-center justify-center text-xs font-medium text-muted-foreground border border-[hsl(var(--border))]"
          >
            {user?.firstName?.[0] || 'U'}
          </button>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col bg-[hsl(var(--card))] border-r border-[hsl(var(--border))] transition-all duration-200 z-20"
        style={{ width: sidebarWidth }}
      >
        <div className="flex items-center justify-between px-2 py-5 mb-2">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-9 h-9 min-w-[36px] rounded-lg flex items-center justify-center text-foreground">
              <Logo className="w-full h-full" />
            </div>
            {sidebarExpanded && <span className="text-base font-semibold whitespace-nowrap">Eavesight</span>}
          </Link>
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--muted))] transition-all"
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg
              className={`w-4 h-4 transition-transform ${sidebarExpanded ? '' : 'rotate-180'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 flex flex-col gap-0.5 px-2">
          {desktopNavItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-2.5 py-2.5 rounded-lg transition-all duration-150',
                isActive(href)
                  ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--muted))]',
              )}
            >
              <Icon className="w-5 h-5 min-w-[20px]" />
              {sidebarExpanded && <span className="text-sm font-medium whitespace-nowrap">{label}</span>}
              {href === '/dashboard/alerts' && alertCount > 0 && sidebarExpanded && (
                <span
                  className={cn(
                    'ml-auto text-[10px] font-bold rounded-full px-1.5 py-0.5',
                    hasExtreme
                      ? 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]'
                      : 'bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]',
                  )}
                >
                  {alertCount}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="px-2 pb-4 space-y-1">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-2.5 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--muted))] transition-all"
          >
            <LogOut className="w-5 h-5 min-w-[20px]" />
            {sidebarExpanded && <span className="text-sm font-medium whitespace-nowrap">Logout</span>}
          </button>
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-2.5 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--muted))] transition-all"
            title={appTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {appTheme === 'dark' ? (
              <Sun className="w-5 h-5 min-w-[20px]" />
            ) : (
              <Moon className="w-5 h-5 min-w-[20px]" />
            )}
            {sidebarExpanded && (
              <span className="text-sm font-medium whitespace-nowrap">
                {appTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </span>
            )}
          </button>
          <div className="flex items-center gap-3 px-2.5 py-2">
            <div className="w-8 h-8 min-w-[32px] bg-[hsl(var(--muted))] rounded-full flex items-center justify-center text-xs font-medium text-muted-foreground border border-[hsl(var(--border))]">
              {user?.firstName?.[0] || 'U'}
            </div>
            {sidebarExpanded && (
              <div className="overflow-hidden">
                <p className="text-sm font-medium truncate">{user?.firstName || 'User'}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email || ''}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto pb-20 md:pb-0">
        <LiveAlertBanner />
        {children}
      </main>

      {/* Mobile bottom tab bar — 4 tabs + center FAB */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-[hsl(var(--card))]/95 backdrop-blur-lg border-t border-[hsl(var(--border))] z-20"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="relative flex items-stretch justify-around px-2 pt-1.5 pb-1.5">
          {mobileNavItems.slice(0, 2).map((item, i) => (
            <MobileTab
              key={i}
              item={item}
              active={'href' in item ? isActive(item.href) : false}
              alertCount={alertCount}
              hasExtreme={hasExtreme}
              onMore={() => setMoreOpen(true)}
            />
          ))}

          <div className="flex items-center justify-center w-16">
            <button
              type="button"
              onClick={() => setCaptureOpen(true)}
              aria-label="Quick capture"
              className={cn(
                'w-14 h-14 -mt-6 rounded-full grid place-items-center shadow-lg',
                'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                'ring-4 ring-[hsl(var(--background))] hover:brightness-110 active:scale-95 transition-all',
              )}
            >
              <Plus className="w-6 h-6" strokeWidth={2.5} />
            </button>
          </div>

          {mobileNavItems.slice(2).map((item, i) => (
            <MobileTab
              key={i + 2}
              item={item}
              active={'href' in item ? isActive(item.href) : false}
              alertCount={alertCount}
              hasExtreme={hasExtreme}
              onMore={() => setMoreOpen(true)}
            />
          ))}
        </div>
      </nav>

      {/* Sheets */}
      <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <QuickCaptureSheet open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------

function MobileTab({
  item,
  active,
  alertCount,
  hasExtreme,
  onMore,
}: {
  item: MobileTabItem;
  active: boolean;
  alertCount: number;
  hasExtreme: boolean;
  onMore: () => void;
}) {
  const Icon = item.Icon;
  const common = cn(
    'flex-1 flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors min-w-[56px] relative',
    active ? 'text-[hsl(var(--primary))]' : 'text-muted-foreground',
  );

  if ('kind' in item && item.kind === 'more') {
    return (
      <button type="button" onClick={onMore} className={common} aria-label="More">
        <Icon className="w-5 h-5" />
        <span className="text-[10px] font-medium">{item.label}</span>
      </button>
    );
  }

  const navItem = item as { href: string; label: string; showAlertBadge?: boolean };
  const showBadge = navItem.showAlertBadge && alertCount > 0;

  return (
    <Link href={navItem.href} className={common}>
      <span className="relative inline-flex">
        <Icon className="w-5 h-5" />
        {showBadge && (
          <span
            className={cn(
              'absolute -top-1 -right-2 min-w-[16px] h-[16px] px-1 rounded-full grid place-items-center text-[9px] font-bold',
              hasExtreme
                ? 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] animate-alert-pulse'
                : 'bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]',
            )}
          >
            {alertCount > 99 ? '99+' : alertCount}
          </span>
        )}
      </span>
      <span className="text-[10px] font-medium">{navItem.label}</span>
    </Link>
  );
}
