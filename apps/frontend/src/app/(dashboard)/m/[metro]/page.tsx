'use client';
/**
 * Metro-scoped dashboard: /m/[metro]
 *
 * Parameterized by the url segment :metro. Every API call on this page
 * is metro-scoped so the same component ships with zero changes for
 * Nashville, Austin, Atlanta, etc.
 *
 * Scaling plan:
 *   - MetroMap renders H3 r6 hexes at z<11, r8 hexes at 11-13, pins at z≥13.
 *     Backend never ships raw property rows at low zoom.
 *   - DormantLeadsList reads from property_pin_cards (pre-denormalized).
 *   - Mode toggle (Door/Call) retunes AutoPitchCard output per-property.
 */
import { useParams } from 'next/navigation';
import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useMetro } from '../../../../hooks/useMetro';
import { DormantLeadsList } from '../../../../components/metro/DormantLeadsList';
import { usePreferencesStore } from '@/stores/preferences';
import type { MapView } from '@/components/metro/MetroMap';

// Map is SSR-unsafe (maplibre-gl), dynamic import
const MetroMap = dynamic(
  () => import('../../../../components/metro/MetroMap').then((m) => m.MetroMap),
  { ssr: false, loading: () => <div className="h-full grid place-items-center text-sm text-slate-400">Loading map…</div> },
);

type Mode = 'door' | 'call';

export default function MetroPage() {
  const params = useParams();
  const code = String(params?.metro ?? 'north-alabama');
  const { metro, loading, error } = useMetro(code);
  const [mode, setMode] = useState<Mode>('door');
  const [dormantOnly, setDormantOnly] = useState(true);
  // Key <MetroMap> on appTheme to force a clean remount on light/dark swap.
  // See dashboard/map/page.tsx for the full rationale — tl;dr: MapLibre's
  // in-place `setStyle` path wipes custom sources and races with the basemap
  // symbol layers, leaving the map flat until a manual reload.
  const appTheme = usePreferencesStore((s) => s.appTheme);
  // Ref survives the theme-keyed remount; used to restore camera state so
  // the swap doesn't feel like a scene reset. MetroMap emits onViewChange
  // on every idle (move/zoom/rotate/pitch end).
  const viewRef = useRef<MapView | null>(null);
  const handleViewChange = useCallback((v: MapView) => {
    viewRef.current = v;
  }, []);
  // Wash curtain for the remount flash. 250ms, CSS-only, re-keys on theme.
  const [washKey, setWashKey] = useState(0);
  useEffect(() => {
    setWashKey((k) => k + 1);
  }, [appTheme]);

  if (loading) return <div className="p-8">Loading {code}…</div>;
  if (error) return <div className="p-8 text-red-600">Error: {error.message}</div>;
  if (!metro) return null;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-3rem)]">
      {/* Left: map */}
      <div className="flex-1 min-h-[320px] relative bg-slate-100">
        <MetroMap
          key={appTheme}
          metroCode={code}
          dormantOnly={dormantOnly}
          center={viewRef.current?.center}
          initialZoom={viewRef.current?.zoom}
          initialBearing={viewRef.current?.bearing}
          initialPitch={viewRef.current?.pitch}
          onViewChange={handleViewChange}
        />
        <div
          key={washKey}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 bg-background animate-map-wash"
        />
      </div>

      {/* Right: sidebar */}
      <aside className="w-full lg:w-[420px] border-l border-slate-200 bg-white overflow-y-auto p-4 space-y-5">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-lg font-semibold">{metro.name}</h1>
            <p className="text-xs text-slate-500">
              {metro.stateCodes.join(' · ')} · {metro.coverage.propertyCount.toLocaleString()} properties
            </p>
          </div>
          <span className="px-2 py-0.5 text-[10px] uppercase bg-emerald-100 text-emerald-800 rounded">
            {metro.tier}
          </span>
        </header>

        <section className="grid grid-cols-2 gap-2">
          <StatCard label="Scored" value={metro.coverage.scoredCount} total={metro.coverage.propertyCount} />
          <StatCard label="Dormant" value={metro.coverage.dormantCount} accent="amber" />
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <ToggleGroup
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={[
                { v: 'door', label: 'Door' },
                { v: 'call', label: 'Call' },
              ]}
            />
            <button
              type="button"
              onClick={() => setDormantOnly((v) => !v)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                dormantOnly
                  ? 'bg-amber-100 text-amber-900 border-amber-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              aria-pressed={dormantOnly}
            >
              Dormant {dormantOnly ? '✓' : ''}
            </button>
          </div>
          <DormantLeadsList metroCode={code} limit={12} dormantOnly={dormantOnly} mode={mode} />
        </section>
      </aside>
    </div>
  );
}

function StatCard({
  label,
  value,
  total,
  accent,
}: {
  label: string;
  value: number | null;
  total?: number;
  accent?: 'amber' | 'emerald';
}) {
  const accentCls =
    accent === 'amber'
      ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'bg-white border-slate-200';
  return (
    <div className={`border rounded-lg p-2.5 ${accentCls}`}>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold">
        {value === null ? '…' : value.toLocaleString()}
        {total ? (
          <span className="text-xs text-slate-400 ml-1.5">/ {total.toLocaleString()}</span>
        ) : null}
      </div>
    </div>
  );
}

function ToggleGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ v: T; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white overflow-hidden">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 text-xs font-medium ${
            value === o.v
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
          aria-pressed={value === o.v}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
