'use client';

import { useRouter } from 'next/navigation';
import {
  Home,
  Layers,
  Users,
  Trophy,
  BarChart3,
  Settings,
  LogOut,
  Moon,
  Sun,
  Building2,
} from 'lucide-react';
import { Sheet, SheetAction, SheetDivider } from '@/components/ui/sheet';
import { useAuthStore } from '@/stores/auth';
import { usePreferencesStore } from '@/stores/preferences';

/**
 * MobileMoreSheet — overflow menu for secondary nav items that don't fit
 * in the 4-item mobile bottom bar. Rendered from the "More" tab.
 *
 * Primary mobile tabs:   Map · Leads · Capture(FAB) · Alerts · More(this)
 * Desktop sidebar keeps all 9 items.
 */
interface Props {
  open: boolean;
  onClose: () => void;
}

export function MobileMoreSheet({ open, onClose }: Props) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const appTheme = usePreferencesStore((s) => s.appTheme);
  const setAppTheme = usePreferencesStore((s) => s.setAppTheme);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

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

  const handleLogout = () => {
    onClose();
    logout();
    router.push('/login');
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={user?.firstName ? `Hi, ${user.firstName}` : 'More'}
      description="Everything else on your account"
      dense
    >
      <div className="flex flex-col">
        {/* Primary overflow routes */}
        <SheetAction icon={Home} label="Home" description="Today at a glance" onClick={() => go('/dashboard')} />
        <SheetAction icon={Layers} label="Pipeline" description="Kanban across all stages" onClick={() => go('/dashboard/pipeline')} />
        <SheetAction icon={Users} label="Prospects" description="Unassigned + cold list" onClick={() => go('/dashboard/prospects')} />
        <SheetAction icon={Building2} label="Properties" description="Browse the full catalog" onClick={() => go('/dashboard/properties')} />

        <SheetDivider />

        {/* Desktop-heavy sections (we still let them open, but warn that it's best on desktop) */}
        <SheetAction icon={Trophy} label="Team" description="Leaderboard · forecast · decay" onClick={() => go('/dashboard/team')} />
        <SheetAction icon={BarChart3} label="Analytics" description="Reports · charts · exports" onClick={() => go('/dashboard/analytics')} />

        <SheetDivider />

        {/* Account */}
        <SheetAction
          icon={appTheme === 'dark' ? Sun : Moon}
          label={appTheme === 'dark' ? 'Light mode' : 'Dark mode'}
          onClick={toggleTheme}
        />
        <SheetAction icon={Settings} label="Settings" onClick={() => go('/dashboard/settings')} />
        <SheetAction icon={LogOut} label="Log out" onClick={handleLogout} danger />
      </div>
    </Sheet>
  );
}

export default MobileMoreSheet;
