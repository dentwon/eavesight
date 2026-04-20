'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Flame,
  MapPin,
  Phone,
  Plus,
  Target,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useStormAlerts } from '@/hooks/useStormAlerts';
import { cn } from '@/lib/utils';

/**
 * MobileFieldHome — the rep-in-the-truck home screen.
 *
 * Three stacks, top to bottom:
 *   1. Live storm card (only when there's an active alert — huge red CTA)
 *   2. "Open Map" hero tile — primary action, big thumb target
 *   3. Today's hot leads (6 max) with one-tap call + open
 *
 * Deliberately excludes: pipeline charts, team leaderboards, revenue forecasts,
 * territory equity. Those belong on the desktop dashboard, not in the field.
 *
 * Rendered with `md:hidden`; desktop uses the full analytics dashboard.
 */
interface Lead {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  status: string;
  score: number;
  quotedAmount?: number;
  property?: {
    id: string;
    address?: string;
    city?: string;
    zip?: string;
  };
}

export function MobileFieldHome({ onOpenCapture }: { onOpenCapture?: () => void }) {
  const { user } = useAuthStore();
  const { activeAlerts, hasExtreme } = useStormAlerts();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<Lead[]>('/leads', { params: { limit: 50 } });
        if (!cancelled) setLeads(Array.isArray(res.data) ? res.data : []);
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.orgId]);

  const hotLeads = leads
    .filter((l) => l.status !== 'WON' && l.status !== 'LOST' && (l.score ?? 0) >= 55)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Morning';
    if (h < 17) return 'Afternoon';
    return 'Evening';
  })();

  return (
    <div className="md:hidden p-4 space-y-4">
      {/* Greeting */}
      <div>
        <p className="text-xs text-muted-foreground">Today · {new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}</p>
        <h1 className="text-xl font-semibold mt-0.5">
          {greeting}{user?.firstName ? `, ${user.firstName}` : ''}
        </h1>
      </div>

      {/* Live storm CTA — only when active */}
      {activeAlerts.length > 0 && (
        <Link
          href="/dashboard/alerts"
          className={cn(
            'block rounded-2xl p-4 shadow-sm',
            hasExtreme
              ? 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] animate-alert-pulse'
              : 'bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]',
          )}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-7 h-7 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wide font-semibold opacity-90">
                {hasExtreme ? 'Live storm' : 'Active weather'}
              </p>
              <p className="text-lg font-bold leading-tight">
                {activeAlerts.length} {activeAlerts.length === 1 ? 'property' : 'properties'} under alert
              </p>
              <p className="text-xs opacity-80 mt-0.5">Tap to earmark and start working the list →</p>
            </div>
          </div>
        </Link>
      )}

      {/* Hero: Open Map */}
      <Link
        href="/dashboard/map"
        className="block rounded-2xl p-5 bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-[hsl(var(--primary-foreground))] shadow-sm active:scale-[0.99] transition-transform"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/15 grid place-items-center shrink-0">
            <MapPin className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wide opacity-80">Primary view</p>
            <p className="text-lg font-bold">Open the map</p>
            <p className="text-sm opacity-90 mt-0.5">See opportunities around you</p>
          </div>
          <ArrowRight className="w-5 h-5 mt-1 opacity-80" />
        </div>
      </Link>

      {/* Quick tiles */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onOpenCapture}
          className="rounded-2xl p-4 text-left bg-[hsl(var(--card))] border border-[hsl(var(--border))] active:scale-[0.99] transition-transform"
        >
          <div className="w-9 h-9 rounded-lg bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] grid place-items-center mb-2">
            <Plus className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold">Quick capture</p>
          <p className="text-xs text-muted-foreground mt-0.5">Drop a lead from GPS</p>
        </button>
        <Link
          href="/dashboard/leads"
          className="rounded-2xl p-4 bg-[hsl(var(--card))] border border-[hsl(var(--border))] active:scale-[0.99] transition-transform"
        >
          <div className="w-9 h-9 rounded-lg bg-[hsl(var(--accent))]/15 text-[hsl(var(--accent))] grid place-items-center mb-2">
            <Target className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold">My leads</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading ? '…' : `${hotLeads.length} hot`}
          </p>
        </Link>
      </div>

      {/* Today's hot leads */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-[hsl(var(--destructive))]" />
            Today's hot list
          </h2>
          <Link href="/dashboard/leads" className="text-xs font-medium text-[hsl(var(--primary))]">
            See all
          </Link>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />
            ))}
          </div>
        ) : hotLeads.length === 0 ? (
          <div className="rounded-2xl p-6 bg-[hsl(var(--card))] border border-dashed border-[hsl(var(--border))] text-center">
            <Bookmark className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">No hot leads yet</p>
            <p className="text-xs text-muted-foreground mt-1">Start canvassing from the map.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {hotLeads.map((lead) => {
              const name = lead.displayName || [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unnamed';
              const addr = lead.property?.address || '—';
              return (
                <li
                  key={lead.id}
                  className="rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] p-3 flex items-center gap-3"
                >
                  <div
                    className={cn(
                      'w-10 h-10 rounded-lg grid place-items-center shrink-0 text-sm font-bold',
                      lead.score >= 80
                        ? 'bg-[hsl(var(--destructive))]/15 text-[hsl(var(--destructive))]'
                        : lead.score >= 65
                          ? 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]'
                          : 'bg-[hsl(var(--info))]/15 text-[hsl(var(--info))]',
                    )}
                  >
                    {lead.score ?? '—'}
                  </div>
                  <Link href={`/dashboard/leads/${lead.id}`} className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {addr}
                    </p>
                  </Link>
                  {lead.phone && (
                    <a
                      href={`tel:${lead.phone}`}
                      className="w-9 h-9 rounded-lg bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] grid place-items-center active:scale-95 transition-transform"
                      aria-label={`Call ${name}`}
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-center text-[11px] text-muted-foreground pt-2">
        Full pipeline &amp; team reports on desktop · <Zap className="inline w-3 h-3" /> Eavesight
      </p>
    </div>
  );
}

export default MobileFieldHome;
