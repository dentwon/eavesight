'use client';

import { useState, useCallback } from 'react';
import api from '@/lib/api';
import dynamic from 'next/dynamic';
import { usePreferencesStore } from '@/stores/preferences';
import { getPropertyValue } from '@/lib/propertyValue';
import { MapPropertySheet } from '@/components/MapPropertySheet';
import { QuickCaptureSheet } from '@/components/QuickCaptureSheet';
import { DataConfidenceBadge } from '@/components/DataConfidenceBadge';

const StormMap = dynamic(() => import('@/components/map/StormMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-slate-900 text-slate-400">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
        <p>Loading map…</p>
      </div>
    </div>
  ),
});

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

  const handleBuildingClick = useCallback(async (building: any) => {
    let next: any = null;
    try {
      const res = await api.get(`/map/pmtiles/${building.id}/property`);
      if (res.data) next = res.data;
    } catch (err) {
      console.warn('Failed to fetch property by PMTiles ID:', err);
    }

    if (!next) {
      next = {
        id: building.id,
        lat: building.lat,
        lon: building.lon,
        areaSqft: building.areaSqft,
        address: 'Building ID: ' + building.id,
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
      <aside
        className={`flex-shrink-0 relative bg-slate-900/95 border-r border-slate-700/50 transition-all duration-200 hidden md:flex flex-col z-10 ${
          sidebarExpanded ? 'w-80' : 'w-10'
        }`}
      >
        <button
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          className="absolute top-1/2 -translate-y-1/2 w-5 h-12 bg-slate-800 border border-slate-700/50 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
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
            <div className="px-4 py-3 border-b border-slate-700/50">
              <h2 className="text-sm font-semibold text-white">Building Details</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Click a building on the map to see details
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {selectedBuilding ? (
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {selectedBuilding.address || 'Unknown Address'}
                    </p>
                    <p className="text-xs text-slate-500">ID: {selectedBuilding.id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Owner</p>
                    <p className="text-xs text-slate-300">
                      {selectedBuilding.ownerFullName || selectedBuilding.propertyOwner || 'Unknown'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Property Value</p>
                      <p className="text-sm font-medium text-white">
                        {(() => {
                          const v = getPropertyValue(selectedBuilding);
                          return v ? `$${Math.round(v).toLocaleString()}` : 'N/A';
                        })()}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Year Built</p>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-white">
                          {selectedBuilding.yearBuilt || selectedBuilding.roofData?.yearBuilt || 'N/A'}
                        </p>
                        {(selectedBuilding.yearBuilt || selectedBuilding.roofData?.yearBuilt) && (
                          <DataConfidenceBadge confidence={selectedBuilding.yearBuiltConfidence} />
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Roof Age</p>
                      <p className="text-xs text-slate-300">
                        {selectedBuilding.roofData?.age
                          ? `${selectedBuilding.roofData.age} years`
                          : selectedBuilding.yearBuilt
                            ? `${new Date().getFullYear() - selectedBuilding.yearBuilt} years`
                            : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Area</p>
                      <p className="text-xs text-slate-300">
                        {selectedBuilding.roofAreaSqft
                          ? `${Math.round(selectedBuilding.roofAreaSqft).toLocaleString()} sqft`
                          : selectedBuilding.buildingFootprint?.areaSqft
                            ? `${Number(selectedBuilding.buildingFootprint.areaSqft).toLocaleString()} sqft`
                            : 'N/A'}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Storm History</p>
                    {selectedBuilding.propertyStorms && selectedBuilding.propertyStorms.length > 0 ? (
                      <div className="space-y-2">
                        {selectedBuilding.propertyStorms.slice(0, 3).map((stormLink: any) => {
                          const storm = stormLink.stormEvent;
                          return (
                            <div key={storm.id} className="text-xs border border-slate-700/50 rounded p-2">
                              <p className="text-slate-300">{new Date(storm.date).toLocaleDateString()}</p>
                              <p className="text-slate-400">
                                {storm.type} - {storm.severity || 'Unknown'}
                              </p>
                              {storm.hailSizeInches && (
                                <p className="text-slate-500">Hail: {storm.hailSizeInches}" diameter</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No storm history recorded</p>
                    )}
                  </div>

                  <button
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded text-sm transition-colors mt-4"
                    onClick={() => openLeadFromProperty(selectedBuilding)}
                  >
                    Create Lead
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full px-4 text-center">
                  <p className="text-xs text-slate-500">Click a building on the map to see details</p>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Map */}
      <div className="flex-1 relative">
        <StormMap
          center={[-86.5854, 34.7304]}
          zoom={12}
          onBuildingClick={handleBuildingClick}
          className="w-full h-full"
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
