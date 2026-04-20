'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bookmark,
  CloudLightning,
  CloudRainWind,
  MapPin,
  Phone,
  Tornado,
  Wind,
  Zap,
} from 'lucide-react';
import { useStormAlerts, type ActiveAlert } from '@/hooks/useStormAlerts';
import { EarmarkButton } from '@/components/EarmarkButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { DataConfidenceBadge } from '@/components/DataConfidenceBadge';
import { cn } from '@/lib/utils';

type SortKey = 'severity' | 'hail' | 'recent' | 'zip';

export default function AlertsWorklistPage() {
  const { activeAlerts, connected, error, refresh, hasExtreme } = useStormAlerts();
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterZip, setFilterZip] = useState<string>('');
  const [sort, setSort] = useState<SortKey>('severity');
  const [onlyEarmarked, setOnlyEarmarked] = useState(false);

  const filtered = useMemo(() => {
    let list = [...activeAlerts];
    if (filterType !== 'ALL') list = list.filter((a) => a.alertType === filterType);
    if (filterZip.trim()) list = list.filter((a) => (a.zip ?? '').startsWith(filterZip.trim()));
    if (onlyEarmarked) list = list.filter((a) => a.isEarmarked);
    list.sort(comparator(sort));
    return list;
  }, [activeAlerts, filterType, filterZip, sort, onlyEarmarked]);

  const counts = useMemo(() => {
    const byType = activeAlerts.reduce<Record<string, number>>((acc, a) => {
      acc[a.alertType] = (acc[a.alertType] ?? 0) + 1;
      return acc;
    }, {});
    const earmarked = activeAlerts.filter((a) => a.isEarmarked).length;
    const extreme = activeAlerts.filter((a) => a.severity === 'EXTREME').length;
    return { byType, earmarked, extreme, total: activeAlerts.length };
  }, [activeAlerts]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className={cn('w-6 h-6', hasExtreme ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--warning))]')} />
            <h1 className="text-2xl font-semibold">Active Storm Worklist</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Properties under active NWS warnings or MRMS hail cores. Earmark the ones you&rsquo;re driving today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1',
              connected
                ? 'bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]'
                : 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]',
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-[hsl(var(--success))] animate-pulse' : 'bg-[hsl(var(--warning))]')} />
            {connected ? 'Live feed' : 'Reconnecting…'}
          </span>
          <button
            onClick={refresh}
            className="text-xs font-medium rounded-md border border-[hsl(var(--border))] px-3 py-1.5 hover:bg-[hsl(var(--muted))] transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Properties under alert"
          value={counts.total.toLocaleString()}
          tone={counts.extreme > 0 ? 'destructive' : counts.total > 0 ? 'warning' : 'default'}
          icon={AlertTriangle}
        />
        <StatCard
          label="Extreme severity"
          value={counts.extreme.toLocaleString()}
          tone="destructive"
          icon={Zap}
        />
        <StatCard
          label="Earmarked by team"
          value={counts.earmarked.toLocaleString()}
          tone="accent"
          icon={Bookmark}
        />
        <StatCard
          label="Tornado warnings"
          value={(counts.byType['TORNADO_WARNING'] ?? 0).toLocaleString()}
          tone={counts.byType['TORNADO_WARNING'] ? 'destructive' : 'default'}
          icon={Tornado}
        />
      </div>

      {error && (
        <div className="rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {['ALL', 'TORNADO_WARNING', 'SEVERE_TSTORM', 'HAIL_CORE', 'HIGH_WIND', 'FLOOD'].map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={cn(
                  'text-xs font-medium rounded-full px-3 py-1 border transition-colors',
                  filterType === t
                    ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]'
                    : 'bg-transparent text-muted-foreground border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]',
                )}
              >
                {t === 'ALL' ? 'All' : labelForType(t)}
                {t !== 'ALL' && counts.byType[t] ? ` · ${counts.byType[t]}` : ''}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <input
                type="text"
                placeholder="ZIP prefix"
                value={filterZip}
                onChange={(e) => setFilterZip(e.target.value)}
                className="text-sm rounded-md bg-[hsl(var(--muted))] border border-[hsl(var(--border))] px-2.5 py-1 w-28 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyEarmarked}
                  onChange={(e) => setOnlyEarmarked(e.target.checked)}
                  className="rounded border-[hsl(var(--border))]"
                />
                Earmarked only
              </label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="text-sm rounded-md bg-[hsl(var(--muted))] border border-[hsl(var(--border))] px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              >
                <option value="severity">Sort: severity</option>
                <option value="hail">Sort: hail exposure</option>
                <option value="recent">Sort: most recent</option>
                <option value="zip">Sort: ZIP</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No active alerts matching your filters"
          description={
            activeAlerts.length === 0
              ? 'All clear for now. The feed will flash here the moment a warning drops.'
              : 'Try clearing filters to see all current alerts.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------

function AlertRow({ alert }: { alert: ActiveAlert }) {
  const Icon = iconForType(alert.alertType);
  const sevTone =
    alert.severity === 'EXTREME'
      ? 'destructive'
      : alert.severity === 'SEVERE'
        ? 'warning'
        : 'info';
  return (
    <Card className={cn('transition-all', alert.isEarmarked && 'ring-2 ring-[hsl(var(--accent))]')}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Icon className="w-5 h-5 shrink-0 text-[hsl(var(--destructive))]" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={sevTone as any}>{alert.severity}</Badge>
              <Badge variant="outline">{labelForType(alert.alertType)}</Badge>
              <span className="text-xs text-muted-foreground">
                {sourceLabel(alert.alertSource)}
              </span>
            </div>
            <p className="mt-1.5 text-sm font-medium truncate">
              {alert.address || 'Unknown address'}
            </p>
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" />
              {[alert.city, alert.zip].filter(Boolean).join(' · ') || '—'}
            </p>
            {alert.hailExposureIndex != null && (
              <p className="text-xs text-muted-foreground mt-1">
                Hail exposure: <span className="font-medium text-foreground">{alert.hailExposureIndex.toFixed(1)}</span>
              </p>
            )}
            {alert.yearBuilt && (
              <div className="flex items-center gap-1.5 mt-1">
                <p className="text-xs text-muted-foreground">
                  Built: <span className="font-medium text-foreground">{alert.yearBuilt}</span>
                </p>
                <DataConfidenceBadge confidence={alert.yearBuiltConfidence} />
                {alert.roofSizeClass && (
                  <span className="text-[10px] rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-muted-foreground">
                    {alert.roofSizeClass}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[hsl(var(--border))]">
          <div className="text-[11px] text-muted-foreground">
            Started {fmtRelative(alert.startedAt)}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/properties/${alert.propertyId}`}
              className="text-xs font-medium rounded-md border border-[hsl(var(--border))] px-2.5 py-1 hover:bg-[hsl(var(--muted))] transition-colors inline-flex items-center gap-1"
            >
              <Phone className="w-3 h-3" />
              Open
            </Link>
            <EarmarkButton propertyId={alert.propertyId} initialEarmarked={alert.isEarmarked} size="sm" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------

function comparator(key: SortKey) {
  const sevRank = (s: string) => (s === 'EXTREME' ? 3 : s === 'SEVERE' ? 2 : 1);
  return (a: ActiveAlert, b: ActiveAlert) => {
    if (key === 'severity') {
      const d = sevRank(b.severity) - sevRank(a.severity);
      if (d !== 0) return d;
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    }
    if (key === 'hail') return (b.hailExposureIndex ?? 0) - (a.hailExposureIndex ?? 0);
    if (key === 'recent') return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    if (key === 'zip') return (a.zip ?? '').localeCompare(b.zip ?? '');
    return 0;
  };
}

function iconForType(type: string) {
  switch (type) {
    case 'TORNADO_WARNING':
      return Tornado;
    case 'SEVERE_TSTORM':
      return CloudLightning;
    case 'HAIL_CORE':
      return CloudRainWind;
    case 'HIGH_WIND':
      return Wind;
    case 'FLOOD':
      return CloudRainWind;
    default:
      return AlertTriangle;
  }
}

function labelForType(type: string): string {
  switch (type) {
    case 'TORNADO_WARNING':
      return 'Tornado';
    case 'SEVERE_TSTORM':
      return 'Severe T-Storm';
    case 'HAIL_CORE':
      return 'Hail Core';
    case 'HIGH_WIND':
      return 'High Wind';
    case 'FLOOD':
      return 'Flood';
    default:
      return type;
  }
}

function sourceLabel(src: string): string {
  switch (src) {
    case 'NWS_ALERT':
      return 'NWS';
    case 'MRMS_HAIL':
      return 'MRMS';
    case 'NEXRAD':
      return 'NEXRAD';
    case 'SPC_REPORT':
      return 'SPC';
    default:
      return src;
  }
}

function fmtRelative(iso: string): string {
  try {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const mins = Math.round(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}
