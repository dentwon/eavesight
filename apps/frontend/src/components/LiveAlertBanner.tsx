'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CloudLightning,
  CloudRainWind,
  Tornado,
  Wind,
  X,
} from 'lucide-react';
import { useStormAlerts } from '@/hooks/useStormAlerts';
import { cn } from '@/lib/utils';

/**
 * LiveAlertBanner
 *
 * Desktop: full-width banner at the top of the content area. Pulses red for
 * EXTREME, amber for SEVERE. One-click path to the earmark worklist.
 *
 * Mobile: the full banner is hidden (the header already shows a compact
 * pill + the bottom bar shows a badge count). We don't want a fat banner
 * eating screen real estate on a phone.
 */
export function LiveAlertBanner() {
  const { activeAlerts, connected, hasExtreme, latestBatch } = useStormAlerts();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || activeAlerts.length === 0) return null;

  const byType = groupBy(activeAlerts, (a) => a.alertType);
  const topType = Object.keys(byType).sort((a, b) => byType[b].length - byType[a].length)[0];
  const topCount = byType[topType]?.length ?? 0;
  const total = activeAlerts.length;

  const severity = hasExtreme
    ? 'EXTREME'
    : activeAlerts.some((a) => a.severity === 'SEVERE')
      ? 'SEVERE'
      : 'MODERATE';
  const tone =
    severity === 'EXTREME'
      ? 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]'
      : severity === 'SEVERE'
        ? 'bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]'
        : 'bg-[hsl(var(--info))] text-[hsl(var(--info-foreground))]';

  const Icon = iconForType(topType);

  return (
    <div
      role="alert"
      // Hidden on mobile — the compact pill in the header + the badge on the
      // Alerts tab carry the same signal without eating viewport height.
      className={cn(
        'hidden md:flex relative w-full px-4 py-2.5 items-center gap-3',
        'border-b border-[hsl(var(--border))]',
        tone,
        severity === 'EXTREME' && 'animate-alert-pulse',
      )}
    >
      <Icon className="w-5 h-5 shrink-0" aria-hidden />

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-semibold uppercase tracking-wide">
            {severity === 'EXTREME'
              ? 'Live Storm'
              : severity === 'SEVERE'
                ? 'Active Weather'
                : 'Weather Watch'}
          </span>
          <span className="opacity-95">
            {total.toLocaleString()} {total === 1 ? 'property' : 'properties'} under{' '}
            {labelForType(topType)}
            {topCount < total ? ` and ${total - topCount} more` : ''}
          </span>
          {latestBatch?.startedAt && (
            <span className="text-xs opacity-80">· started {fmtTime(latestBatch.startedAt)}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11px] uppercase tracking-wide font-medium rounded-full px-2 py-0.5',
            'bg-black/20 text-white/90',
          )}
          title={connected ? 'Live feed connected' : 'Reconnecting…'}
        >
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              connected ? 'bg-emerald-300 animate-pulse' : 'bg-amber-300',
            )}
          />
          {connected ? 'Live' : 'Reconnect…'}
        </span>

        <Link
          href="/dashboard/alerts"
          className="text-xs font-semibold uppercase tracking-wide rounded-md bg-black/25 hover:bg-black/40 px-3 py-1.5 transition-colors"
        >
          View worklist
        </Link>

        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-md hover:bg-black/25 transition-colors"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------

function iconForType(type: string | undefined) {
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

function labelForType(type: string | undefined): string {
  switch (type) {
    case 'TORNADO_WARNING':
      return 'Tornado Warning';
    case 'SEVERE_TSTORM':
      return 'Severe Thunderstorm';
    case 'HAIL_CORE':
      return 'Hail Core';
    case 'HIGH_WIND':
      return 'High Wind';
    case 'FLOOD':
      return 'Flash Flood';
    default:
      return 'Weather Alert';
  }
}

function groupBy<T, K extends string>(items: T[], key: (x: T) => K): Record<K, T[]> {
  return items.reduce(
    (acc, it) => {
      const k = key(it);
      (acc[k] ||= []).push(it);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default LiveAlertBanner;
