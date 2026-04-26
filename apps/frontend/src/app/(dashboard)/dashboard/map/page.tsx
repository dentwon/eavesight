'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import api from '@/lib/api';
import dynamic from 'next/dynamic';
import { usePreferencesStore } from '@/stores/preferences';
// ^ also used to key <MetroMap> on appTheme — see note near <MetroMap/> below.
import type { MapView } from '@/components/metro/MetroMap';
import { getPropertyValue } from '@/lib/propertyValue';
import { MapPropertySheet } from '@/components/MapPropertySheet';
import { QuickCaptureSheet } from '@/components/QuickCaptureSheet';
import { DataConfidenceBadge } from '@/components/DataConfidenceBadge';
import { consolidateStorms } from '@/lib/consolidateStorms';
import { estimateRoofAge, roofAgeSuffix } from '@/lib/roofAgeEstimate';

// One map component, used here AND on /m/[metro]. Dashboard gets the sidebar
// + lead-capture chrome around it; /m/[metro] uses a lighter wrapper.
const MetroMap = dynamic(
  () => import('@/components/metro/MetroMap').then((m) => m.MetroMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-slate-900 text-slate-400">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p>Loading map…</p>
        </div>
      </div>
    ),
  },
);

export default function MapPage() {
  const [selectedBuilding, setSelectedBuilding] = useState<any>(null);
  // Mobile bottom-sheet visibility (desktop uses the aside instead)
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  // Quick-capture sheet launched from either the mobile sheet's "Lead" button
  // or the desktop sidebar's "Create Lead" button; receives pre-filled initial
  // property so GPS lookup is skipped.
  const [leadInitial, setLeadInitial] = useState<{
    propertyId?: string;
    address?: string;
    lat?: number;
    lon?: number;
  } | null>(null);

  const sidebarExpanded = usePreferencesStore((s) => s.sidebarExpanded);
  const setSidebarExpanded = usePreferencesStore((s) => s.setSidebarExpanded);
  // Theme flips force a full MetroMap remount. MapLibre's `setStyle` wipes all
  // custom sources/layers synchronously and re-installing them in a `styledata`
  // listener races with the basemap's own symbol layers, leaving the map flat
  // until a manual reload. Keying the component on the theme is deterministic:
  // the old instance unmounts (cleanup runs), a fresh one mounts with the
  // correct basemap, and PMTiles/hex responses are browser-cached so the
  // remount is cheap.
  const appTheme = usePreferencesStore((s) => s.appTheme);

  // Camera state survives the keyed remount because refs live on the parent,
  // not the child. MetroMap emits onViewChange on every idle; on remount, the
  // fresh instance reads this ref and mounts at the same center/zoom/pitch.
  // Without this, theme swaps reset the user's scroll to the metro default.
  const viewRef = useRef<MapView>({
    // Huntsville, AL. Fixed metro center until the metro picker lands.
    center: [-86.5854, 34.7304],
    zoom: 10.5,
    // Load flat and true-north-up. Tilt/rotate are opt-in gestures — the
    // HexClad sheen activates above 10° pitch, so the first paint stays a
    // clean baseline state the user can choose to animate into.
    bearing: 0,
    pitch: 0,
  });
  const handleViewChange = useCallback((v: MapView) => {
    viewRef.current = v;
  }, []);

  // Brief curtain on theme swap. Mounts an opacity-1→0 scrim over the map for
  // ~250ms so the remount doesn't flash an empty container. Keyed by
  // appTheme so it re-plays on each flip; uses a CSS animation so there are
  // no JS timers to clean up.
  const [washKey, setWashKey] = useState(0);
  useEffect(() => {
    setWashKey((k) => k + 1);
  }, [appTheme]);

  const handlePropertyClick = useCallback(async (propertyId: string) => {
    // MetroMap emits the property cuid directly. Fetch the full record so the
    // sidebar has owner / value / year-built / roof / storms.
    let next: any = null;
    try {
      const res = await api.get(`/properties/${propertyId}`);
      if (res.data) next = res.data;
    } catch (err) {
      console.warn('[map] property fetch failed:', err);
    }
    if (!next) {
      next = {
        id: propertyId,
        address: 'Property ' + propertyId,
        ownerFullName: 'Unknown',
        assessedValue: null,
        marketValue: null,
        yearBuilt: null,
        propertyStorms: [],
      };
    }
    setSelectedBuilding(next);
    setMobileSheetOpen(true);
  }, []);

  const openLeadFromProperty = useCallback((p: any) => {
    const addressParts = [p.address, p.city, p.zip].filter(Boolean);
    setLeadInitial({
      propertyId: p.id,
      address: addressParts.length ? addressParts.join(', ') : p.address || undefined,
      lat: typeof p.lat === 'number' ? p.lat : undefined,
      lon: typeof p.lon === 'number' ? p.lon : undefined,
    });
    // When launched from the mobile sheet, close it so QuickCapture takes over
    setMobileSheetOpen(false);
  }, []);

  return (
    <div className="flex h-full">
      {/* Desktop side panel (hidden on mobile — mobile uses MapPropertySheet) */}
      {/* All surface colors read from the HSL token system (see globals.css)
          so the aside flips automatically between light and dark. What was
          previously hardcoded `bg-slate-900/95 text-white text-slate-400` now
          uses `bg-card`, `text-card-foreground`, `text-muted-foreground`. */}
      <aside
        className={`flex-shrink-0 relative bg-card/95 text-card-foreground border-r border-border transition-all duration-200 hidden md:flex flex-col z-10 ${
          sidebarExpanded ? 'w-80' : 'w-10'
        }`}
      >
        <button
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          className="absolute top-1/2 -translate-y-1/2 w-5 h-12 bg-muted border border-border rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          style={{ right: '-12px' }}
          title={sidebarExpanded ? 'Collapse panel' : 'Expand panel'}
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${sidebarExpanded ? 'rotate-0' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {sidebarExpanded && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Building Details</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Click a building on the map to see details
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {selectedBuilding ? (
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {selectedBuilding.address || 'Unknown Address'}
                    </p>
                    <p className="text-xs text-muted-foreground">ID: {selectedBuilding.id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Owner</p>
                    <p className="text-xs text-foreground">
                      {selectedBuilding.ownerFullName || selectedBuilding.propertyOwner || 'Unknown'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Property Value</p>
                      <p className="text-sm font-medium text-foreground">
                        {(() => {
                          const v = getPropertyValue(selectedBuilding);
                          return v ? `$${Math.round(v).toLocaleString()}` : 'N/A';
                        })()}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Year Built</p>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-foreground">
                          {selectedBuilding.yearBuilt || 'N/A'}
                        </p>
                        {selectedBuilding.yearBuilt && (
                          <DataConfidenceBadge confidence={selectedBuilding.yearBuiltConfidence} />
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Roof Age</p>
                      {(() => {
                        const est = estimateRoofAge({
                          yearBuilt: selectedBuilding.yearBuilt,
                          roofInstalledAt: selectedBuilding.roofInstalledAt ?? null,
                          roofInstalledSource: selectedBuilding.roofInstalledSource ?? null,
                          roofData: selectedBuilding.roofData,
                        });
                        return (
                          <p
                            className="text-xs text-foreground"
                            title={
                              est.source === 'inferred'
                                ? 'Estimated from year built (22-yr cycle)'
                                : est.source === 'coc'
                                  ? 'From Certificate of Occupancy'
                                  : est.source === 'permit'
                                    ? 'From building permit'
                                    : est.source === 'measured'
                                      ? 'Measured roof age'
                                      : undefined
                            }
                          >
                            {est.age != null
                              ? `${est.age} years${roofAgeSuffix(est.source)}`
                              : 'N/A'}
                          </p>
                        );
                      })()}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Area</p>
                      <p className="text-xs text-foreground">
                        {selectedBuilding.roofAreaSqft
                          ? `${Math.round(selectedBuilding.roofAreaSqft).toLocaleString()} sqft`
                          : selectedBuilding.buildingFootprint?.areaSqft
                            ? `${Number(selectedBuilding.buildingFootprint.areaSqft).toLocaleString()} sqft`
                            : 'N/A'}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Storm History</p>
                    {(() => {
                      const consolidated = consolidateStorms(selectedBuilding.propertyStorms || []);
                      if (consolidated.length === 0) {
                        return <p className="text-xs text-muted-foreground">No storm history recorded</p>;
                      }
                      return (
                        <div className="space-y-2">
                          {consolidated.slice(0, 3).map((storm) => (
                            <div key={storm.key} className="text-xs border border-border rounded p-2">
                              <p className="text-foreground">{storm.dateStr}</p>
                              <p className="text-muted-foreground">
                                {storm.type} - {storm.severity || 'Unknown'}
                              </p>
                              {storm.hailSizes.length > 0 && (
                                <p className="text-muted-foreground">
                                  Hail: {storm.hailSizes.map((s) => `${s}"`).join(', ')} diameter
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  <button
                    className="w-full bg-primary hover:brightness-110 text-primary-foreground font-medium py-2 rounded text-sm transition-all mt-4"
                    onClick={() => openLeadFromProperty(selectedBuilding)}
                  >
                    Create Lead
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full px-4 text-center">
                  <p className="text-xs text-muted-foreground">Click a building on the map to see details</p>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Map */}
      <div className="flex-1 relative">
        <MetroMap
          key={appTheme}
          metroCode="north-alabama"
          center={viewRef.current.center}
          // 10.5 = metro-scale view with hex heatmap visible on load.
          // User can zoom to 13-15 to see PMTiles buildings; hexes now fade
          // gently into a texture behind them rather than vanishing at 12.
          initialZoom={viewRef.current.zoom}
          initialBearing={viewRef.current.bearing}
          initialPitch={viewRef.current.pitch}
          onViewChange={handleViewChange}
          onPinClick={handlePropertyClick}
        />
        {/* Theme-swap curtain. One-shot CSS animation keyed off `washKey`,
            so it only paints during the ~250ms around a remount and doesn't
            eat input the rest of the time. `bg-background` reads the
            incoming theme's surface token, so the flash stays neutral on
            either direction. */}
        <div
          key={washKey}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 bg-background animate-map-wash"
        />
      </div>

      {/* Mobile-only bottom sheet. Wrapped in md:hidden so it never mounts on
          desktop (where the aside already shows the same info). */}
      <div className="md:hidden">
        <MapPropertySheet
          open={mobileSheetOpen}
          property={selectedBuilding}
          onClose={() => setMobileSheetOpen(false)}
          onCreateLead={openLeadFromProperty}
        />
      </div>

      {/* Quick capture — shared by mobile sheet & desktop sidebar Create Lead */}
      <QuickCaptureSheet
        open={!!leadInitial}
        onClose={() => setLeadInitial(null)}
        initial={leadInitial ?? undefined}
      />
    </div>
  );
}
