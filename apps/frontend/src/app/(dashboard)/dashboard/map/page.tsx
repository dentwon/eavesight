'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '@/lib/api';
import dynamic from 'next/dynamic';

// Dynamically import MapLibre (SSR incompatible)
const MapGL = dynamic(() => import('./MapView'), { ssr: false, loading: () => (
  <div className="flex items-center justify-center h-full bg-slate-900 text-slate-400">
    <div className="text-center">
      <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
      <p>Loading map…</p>
    </div>
  </div>
)});

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
    showHighValue: false,
    showFloodZone: false,
  });
  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null);
  const fetchCount = useRef(0);

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
    if (v >= 500000) return '#e11d48'; // rose-600 — premium
    if (v >= 300000) return '#f97316'; // orange-500 — high
    if (v >= 200000) return '#eab308'; // yellow-500 — mid-high
    if (v >= 100000) return '#22c55e'; // green-500 — standard
    if (v >= 50000) return '#3b82f6';  // blue-500 — entry
    return '#94a3b8';                 // slate-400 — low/unknown
  };

  const valueLabel = (p: Parcel) => {
    const v = p.totalAppraisedValue;
    if (!v) return 'No value data';
    if (v >= 500000) return 'Premium ($500K+)';
    if (v >= 300000) return `High ($${(v/1000).toFixed(0)}K)`;
    if (v >= 200000) return `Mid-High ($${(v/1000).toFixed(0)}K)`;
    if (v >= 100000) return `Standard ($${(v/1000).toFixed(0)}K)`;
    return `Entry ($${(v/1000).toFixed(0)}K)`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700 text-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold text-white">Prospect Map</h1>
          <span className="text-slate-400">
            {loading ? (
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                Loading…
              </span>
            ) : (
              <span>
                <span className="text-white font-medium">{count.toLocaleString()}</span>
                <span className="text-slate-400"> parcels in view</span>
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Min value filter */}
          <label className="flex items-center gap-2 text-slate-300">
            Min value:
            <select
              value={filters.minValue}
              onChange={e => setFilters(f => ({ ...f, minValue: Number(e.target.value) }))}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-xs"
            >
              <option value={0}>Any</option>
              <option value={50000}>$50K+</option>
              <option value={100000}>$100K+</option>
              <option value={200000}>$200K+</option>
              <option value={300000}>$300K+</option>
              <option value={500000}>$500K+</option>
            </select>
          </label>
          {/* Legend */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Value:</span>
            {[
              { color: '#3b82f6', label: '$50K' },
              { color: '#22c55e', label: '$100K' },
              { color: '#eab308', label: '$200K' },
              { color: '#f97316', label: '$300K' },
              { color: '#e11d48', label: '$500K+' },
            ].map(l => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
                <span className="text-slate-400">{l.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapGL
          parcels={parcels}
          onBoundsChange={handleBoundsChange}
          valueColor={valueColor}
          onParcelClick={setSelectedParcel}
        />

        {/* Sidebar overlay */}
        {selectedParcel && (
          <div className="absolute top-4 right-4 w-72 bg-slate-900/95 border border-slate-700 rounded-lg shadow-xl text-white text-sm z-[1000]">
            <div className="flex items-start justify-between p-3 border-b border-slate-700">
              <div>
                <p className="font-semibold text-white">{selectedParcel.propertyAddress || 'Unknown'}</p>
                <p className="text-slate-400 text-xs">{selectedParcel.pin}</p>
              </div>
              <button
                onClick={() => setSelectedParcel(null)}
                className="text-slate-400 hover:text-white ml-2"
              >✕</button>
            </div>
            <div className="p-3 space-y-2">
              <div>
                <p className="text-slate-400 text-xs">Owner</p>
                <p className="text-white">{selectedParcel.propertyOwner || 'Unknown'}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Mailing</p>
                <p className="text-slate-300 text-xs">{selectedParcel.mailingAddressFull || '—'}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-slate-400 text-xs">Appraised Value</p>
                  <p className="text-white font-medium">
                    {selectedParcel.totalAppraisedValue
                      ? `$${selectedParcel.totalAppraisedValue.toLocaleString()}`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Building Value</p>
                  <p className="text-white font-medium">
                    {selectedParcel.totalBuildingValue
                      ? `$${selectedParcel.totalBuildingValue.toLocaleString()}`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Zoning</p>
                  <p className="text-slate-300 text-xs">{selectedParcel.zoning || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Flood Zone</p>
                  <p className="text-slate-300 text-xs">{selectedParcel.floodZone || '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-slate-400 text-xs">Acres</p>
                  <p className="text-slate-300 text-xs">{selectedParcel.acres ? `${selectedParcel.acres.toFixed(2)} acres` : '—'}</p>
                </div>
              </div>
              <button
                className="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded transition"
                onClick={() => {
                  // TODO: open lead creation modal or navigate to lead page
                  alert(`Create lead for ${selectedParcel.propertyAddress}`);
                }}
              >
                Create Lead
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
