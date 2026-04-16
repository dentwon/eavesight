'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '@/lib/api';
import dynamic from 'next/dynamic';
import { usePreferencesStore } from '@/stores/preferences';

const MapGL = dynamic(() => import('./MapView'), {
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

interface Parcel {
  pin: string;
  propertyAddress: string;
  propertyOwner: string;
  mailingAddressFull: string;
  totalAppraisedValue: number | null;
  totalBuildingValue: number | null;
  acres: number | null;
  zoning: string | null;
  floodZone: string | null;
  lat: number;
  lon: number;
}

interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export default function MapPage() {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [filters, setFilters] = useState({
    minValue: 50000,
  });
  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null);
  const fetchCount = useRef(0);

  const sidebarExpanded = usePreferencesStore((s) => s.sidebarExpanded);
  const setSidebarExpanded = usePreferencesStore((s) => s.setSidebarExpanded);

  const fetchParcels = useCallback(async (mapBounds: MapBounds) => {
    setLoading(true);
    const currentFetch = ++fetchCount.current;
    try {
      const res = await api.get('/madison/map', {
        params: {
          north: mapBounds.north.toFixed(6),
          south: mapBounds.south.toFixed(6),
          east: mapBounds.east.toFixed(6),
          west: mapBounds.west.toFixed(6),
          limit: 3000,
          minValue: filters.minValue,
        },
      });
      if (currentFetch === fetchCount.current) {
        setParcels(res.data.parcels || []);
        setCount(res.data.count || 0);
        setBounds(mapBounds);
      }
    } catch (err) {
      console.error('Failed to fetch parcels', err);
    } finally {
      if (currentFetch === fetchCount.current) setLoading(false);
    }
  }, [filters.minValue]);

  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    fetchParcels(newBounds);
  }, [fetchParcels]);

  const valueColor = (p: Parcel) => {
    const v = p.totalAppraisedValue || 0;
    if (v >= 500000) return '#e11d48';
    if (v >= 300000) return '#f97316';
    if (v >= 200000) return '#eab308';
    if (v >= 100000) return '#22c55e';
    if (v >= 50000) return '#3b82f6';
    return '#94a3b8';
  };

  const valueLabel = (p: Parcel) => {
    const v = p.totalAppraisedValue;
    if (!v) return 'No value data';
    if (v >= 500000) return 'Premium ($500K+)';
    if (v >= 300000) return `High ($${(v / 1000).toFixed(0)}K)`;
    if (v >= 200000) return `Mid-High ($${(v / 1000).toFixed(0)}K)`;
    if (v >= 100000) return `Standard ($${(v / 1000).toFixed(0)}K)`;
    return `Entry ($${(v / 1000).toFixed(0)}K)`;
  };

  return (
    <div className="flex h-full">
      {/* Side panel */}
      <aside
        className={`flex-shrink-0 relative bg-slate-900/95 border-r border-slate-700/50 transition-all duration-200 flex flex-col z-10 ${
          sidebarExpanded ? 'w-72' : 'w-10'
        }`}
      >
        {/* Collapse chevron */}
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
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-700/50">
              <h2 className="text-sm font-semibold text-white">Prospect Map</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {loading ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                    Loading…
                  </span>
                ) : (
                  <span>
                    <span className="text-white font-medium">{count.toLocaleString()}</span>
                    <span className="text-slate-400"> parcels in view</span>
                  </span>
                )}
              </p>
            </div>

            {/* Filters */}
            <div className="px-4 py-3 border-b border-slate-700/50 space-y-2">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                Min value:
                <select
                  value={filters.minValue}
                  onChange={(e) => setFilters((f) => ({ ...f, minValue: Number(e.target.value) }))}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-xs flex-1"
                >
                  <option value={0}>Any</option>
                  <option value={50000}>$50K+</option>
                  <option value={100000}>$100K+</option>
                  <option value={200000}>$200K+</option>
                  <option value={300000}>$300K+</option>
                  <option value={500000}>$500K+</option>
                </select>
              </label>
            </div>

            {/* Legend */}
            <div className="px-4 py-3 border-b border-slate-700/50">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">Value Legend</p>
              <div className="space-y-1">
                {[
                  { color: '#e11d48', label: '$500K+', text: 'text-rose-500' },
                  { color: '#f97316', label: '$300K+', text: 'text-orange-500' },
                  { color: '#eab308', label: '$200K+', text: 'text-yellow-500' },
                  { color: '#22c55e', label: '$100K+', text: 'text-green-500' },
                  { color: '#3b82f6', label: '$50K+', text: 'text-blue-500' },
                ].map((l) => (
                  <div key={l.label} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
                    <span className="text-xs text-slate-400">{l.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Selected parcel detail */}
            <div className="flex-1 overflow-y-auto">
              {selectedParcel ? (
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{selectedParcel.propertyAddress || 'Unknown'}</p>
                    <p className="text-xs text-slate-500">{selectedParcel.pin}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Owner</p>
                    <p className="text-xs text-slate-300">{selectedParcel.propertyOwner || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Mailing</p>
                    <p className="text-xs text-slate-400">{selectedParcel.mailingAddressFull || '—'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Appraised</p>
                      <p className="text-sm font-medium text-white">
                        {selectedParcel.totalAppraisedValue
                          ? `$${selectedParcel.totalAppraisedValue.toLocaleString()}`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Building</p>
                      <p className="text-sm font-medium text-white">
                        {selectedParcel.totalBuildingValue
                          ? `$${selectedParcel.totalBuildingValue.toLocaleString()}`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Zoning</p>
                      <p className="text-xs text-slate-300">{selectedParcel.zoning || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Flood Zone</p>
                      <p className="text-xs text-slate-300">{selectedParcel.floodZone || '—'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">Acres</p>
                      <p className="text-xs text-slate-300">
                        {selectedParcel.acres ? `${Number(selectedParcel.acres).toFixed(2)} acres` : '—'}
                      </p>
                    </div>
                  </div>
                  <button
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded text-sm transition-colors"
                    onClick={() => {
                      alert(`Create lead for ${selectedParcel.propertyAddress}`);
                    }}
                  >
                    Create Lead
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full px-4 text-center">
                  <p className="text-xs text-slate-500">Click a parcel on the map to see details</p>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Map */}
      <div className="flex-1 relative">
        <MapGL
          parcels={parcels}
          onBoundsChange={handleBoundsChange}
          valueColor={valueColor}
          onParcelClick={setSelectedParcel}
        />
      </div>
    </div>
  );
}