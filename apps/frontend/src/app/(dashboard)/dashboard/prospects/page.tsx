'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

interface Parcel {
  pin: string;
  propertyAddress: string;
  propertyOwner: string;
  mailingAddress: string;
  mailingAddressFull: string;
  totalAppraisedValue: number;
  totalBuildingValue: number;
  totalLandValue: number;
  totalAssessedValue: number;
  zoning: string | null;
  floodZone: string | null;
  acres: number | null;
  subdivision: string | null;
  highSchool: string | null;
  hubZone: string | null;
  opportunityZone: string | null;
  eDistrictName: string | null;
  industrialPark: string | null;
  deedDate: string | null;
  // Proximity
  bridgeStreet15: string | null;
  hospital15: string | null;
  marshall15: string | null;
  nhip15: string | null;
  toyota15: string | null;
  bridgeStreet30: string | null;
  hospital30: string | null;
  marshall30: string | null;
  nhip30: string | null;
  toyota30: string | null;
  // Hub data from join
  lead?: {
    id: string;
    status: string;
    score: number;
    priority: string;
  };
}

function estimateRoofAge(appraisedValue: number, buildingValue: number): number | null {
  // Rough estimate: building value / total value ratio suggests age
  // Newer homes (2020+) have building value ~70-80% of total
  // Older homes (1980s) have building value ~50-60% of total
  if (appraisedValue <= 0 || buildingValue <= 0) return null;
  const ratio = buildingValue / appraisedValue;
  if (ratio > 0.72) return 2;   // ~2 years old
  if (ratio > 0.65) return 8;   // ~8 years old
  if (ratio > 0.58) return 15;  // ~15 years old
  if (ratio > 0.50) return 22;  // ~22 years old
  if (ratio > 0.42) return 30;  // ~30 years old
  return 38;                     // ~38+ years old
}

function calcLeadScore(p: Parcel): number {
  let score = 0;
  const val = p.totalAppraisedValue || 0;
  const acres = p.acres || 0.25;

  // Property value: $150K-$400K sweet spot
  if (val >= 150_000) score += 25;
  else if (val >= 100_000) score += 15;
  else if (val >= 50_000) score += 5;

  if (val > 400_000) score += 10; // high value

  // Lot size: larger lots = bigger jobs
  if (acres >= 1) score += 15;
  else if (acres >= 0.5) score += 10;
  else if (acres >= 0.25) score += 5;

  // Zoning flags
  if (p.hubZone) score += 10;
  if (p.opportunityZone) score += 5;
  if (p.industrialPark) score += 8;
  if (p.localHistoricDistrict) score += 8;

  // Proximity to major employers
  const near15 = [p.bridgeStreet15, p.hospital15, p.marshall15, p.nhip15, p.toyota15].filter(Boolean).length;
  const near30 = [p.bridgeStreet30, p.hospital30, p.marshall30, p.nhip30, p.toyota30].filter(Boolean).length;
  score += near15 * 8;
  score += near30 * 3;

  // Flood zone = elevated risk = urgency
  if (p.floodZone) score += 10;

  // Deed recency (recent sales = motivated seller)
  if (p.deedDate) {
    const yearsSinceSale = (Date.now() - new Date(p.deedDate).getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (yearsSinceSale < 2) score += 12;
    else if (yearsSinceSale < 5) score += 6;
  }

  return Math.min(100, score);
}

function getScoreBadge(score: number) {
  if (score >= 75) return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Hot' };
  if (score >= 55) return { bg: 'bg-cyan-500/20', text: 'text-cyan-400', label: 'Warm' };
  if (score >= 35) return { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Cool' };
  return { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Cold' };
}

function ParcelCard({ parcel, onSelect }: { parcel: Parcel; onSelect: (p: Parcel) => void }) {
  const score = calcLeadScore(p);
  const badge = getScoreBadge(score);
  const roofAge = estimateRoofAge(parcel.totalAppraisedValue, parcel.totalBuildingValue);
  const isAlreadyLead = !!parcel.lead;

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 hover:border-cyan-500/30 hover:bg-slate-800/80 transition-all cursor-pointer group"
         onClick={() => onSelect(parcel)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-slate-200 truncate group-hover:text-cyan-400 transition-colors">
              {parcel.propertyAddress}
            </h3>
            {isAlreadyLead && (
              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
                LEAD
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-2">{parcel.mailingAddress}</p>
          <div className="flex flex-wrap items-center gap-2">
            {parcel.propertyOwner && (
              <span className="text-xs text-slate-400 truncate max-w-[160px]" title={parcel.propertyOwner}>
                👤 {parcel.propertyOwner}
              </span>
            )}
            {roofAge !== null && (
              <span className="text-xs text-slate-500">🏠 ~{roofAge}yr roof</span>
            )}
            {parcel.subdivision && (
              <span className="text-xs text-slate-600 truncate max-w-[120px]" title={parcel.subdivision}>
                📍 {parcel.subdivision}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className={`text-xs font-bold px-2 py-1 rounded-lg ${badge.bg} ${badge.text}`}>
            {badge.label} · {score}
          </div>
          {parcel.totalAppraisedValue > 0 && (
            <span className="text-xs font-medium text-slate-300">
              ${(parcel.totalAppraisedValue / 1000).toFixed(0)}K
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ParcelDetail({ parcel, onClose, onCreateLead }: {
  parcel: Parcel;
  onClose: () => void;
  onCreateLead: (p: Parcel) => void;
}) {
  const score = calcLeadScore(p);
  const badge = getScoreBadge(score);
  const roofAge = estimateRoofAge(parcel.totalAppraisedValue, parcel.totalBuildingValue);
  const buildingToLand = parcel.totalAppraisedValue > 0
    ? ((parcel.totalBuildingValue / parcel.totalAppraisedValue) * 100).toFixed(0)
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700/50 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-slate-700/50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-200">{parcel.propertyAddress}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{parcel.mailingAddress}</p>
              {parcel.subdivision && (
                <p className="text-xs text-slate-600 mt-1">📍 {parcel.subdivision}</p>
              )}
            </div>
            <div className={`text-center px-3 py-2 rounded-xl ${badge.bg} shrink-0`}>
              <div className={`text-xl font-black ${badge.text}`}>{score}</div>
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${badge.text}`}>{badge.label}</div>
            </div>
          </div>
        </div>

        {/* Owner & Contact */}
        <div className="p-6 border-b border-slate-700/50">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Owner</h3>
          <p className="text-slate-200 font-medium">{parcel.propertyOwner || 'Unknown'}</p>
          <p className="text-sm text-slate-500 mt-1">{parcel.mailingAddressFull}</p>
          {parcel.lead ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-1 rounded bg-cyan-500/20 text-cyan-400">
                {parcel.lead.status} · Score {parcel.lead.score}
              </span>
              <span className="text-xs text-slate-600">Already a lead</span>
            </div>
          ) : (
            <button
              onClick={() => onCreateLead(parcel)}
              className="mt-3 w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold text-sm transition-colors"
            >
              + Create Lead
            </button>
          )}
        </div>

        {/* Property Value */}
        <div className="p-6 border-b border-slate-700/50">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Property Value</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-800/60 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-slate-200">
                ${(parcel.totalAppraisedValue / 1000).toFixed(0)}K
              </div>
              <div className="text-[10px] text-slate-500 uppercase">Appraised</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-slate-200">
                ${(parcel.totalAssessedValue / 1000).toFixed(0)}K
              </div>
              <div className="text-[10px] text-slate-500 uppercase">Assessed</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-slate-200">
                {roofAge !== null ? `~${roofAge}yr` : '—'}
              </div>
              <div className="text-[10px] text-slate-500 uppercase">Est. Roof Age</div>
            </div>
          </div>
          {buildingToLand && (
            <p className="text-xs text-slate-500 mt-2 text-center">
              Building is {buildingToLand}% of total value
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between px-3 py-1.5 bg-slate-800/40 rounded">
              <span className="text-slate-500">Building</span>
              <span className="text-slate-300">${(parcel.totalBuildingValue / 1000).toFixed(0)}K</span>
            </div>
            <div className="flex justify-between px-3 py-1.5 bg-slate-800/40 rounded">
              <span className="text-slate-500">Land</span>
              <span className="text-slate-300">${(parcel.totalLandValue / 1000).toFixed(0)}K</span>
            </div>
          </div>
        </div>

        {/* Location Signals */}
        {(parcel.zoning || parcel.highSchool || parcel.hubZone || parcel.opportunityZone || parcel.industrialPark) && (
          <div className="p-6 border-b border-slate-700/50">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Location Signals</h3>
            <div className="flex flex-wrap gap-2">
              {parcel.hubZone && (
                <span className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 font-medium">🏆 HubZone</span>
              )}
              {parcel.opportunityZone && (
                <span className="text-xs px-2 py-1 rounded-lg bg-blue-500/20 text-blue-400 font-medium">💰 OppZone</span>
              )}
              {parcel.industrialPark && (
                <span className="text-xs px-2 py-1 rounded-lg bg-purple-500/20 text-purple-400 font-medium">🏭 IndPark</span>
              )}
              {parcel.localHistoricDistrict && (
                <span className="text-xs px-2 py-1 rounded-lg bg-amber-500/20 text-amber-400 font-medium">🏛 Historic</span>
              )}
              {parcel.zoning && (
                <span className="text-xs px-2 py-1 rounded-lg bg-slate-700/60 text-slate-400">Z: {parcel.zoning}</span>
              )}
              {parcel.highSchool && (
                <span className="text-xs px-2 py-1 rounded-lg bg-slate-700/60 text-slate-400">🏫 {parcel.highSchool}</span>
              )}
            </div>
          </div>
        )}

        {/* Flood & Environment */}
        <div className="p-6 border-b border-slate-700/50">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Environment</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Flood Zone</span>
              <span className={`text-sm font-medium ${parcel.floodZone ? 'text-amber-400' : 'text-slate-500'}`}>
                {parcel.floodZone || 'None'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Wetland</span>
              <span className="text-sm text-slate-500">{parcel.wetland || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Lot Size</span>
              <span className="text-sm text-slate-300">
                {parcel.acres ? `${parcel.acres.toFixed(2)} acres` : '—'}
              </span>
            </div>
            {parcel.eDistrictName && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">District</span>
                <span className="text-sm text-slate-300">{parcel.eDistrictName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Proximity */}
        {([parcel.bridgeStreet15, parcel.hospital15, parcel.marshall15, parcel.nhip15, parcel.toyota15,
          parcel.bridgeStreet30, parcel.hospital30, parcel.marshall30, parcel.nhip30, parcel.toyota30]
          .some(Boolean)) && (
          <div className="p-6">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Proximity</h3>
            <div className="space-y-1.5">
              {[
                { key: 'bridgeStreet15', label: '🌉 Bridge St (15 min)' },
                { key: 'hospital15', label: '🏥 Hospital (15 min)' },
                { key: 'marshall15', label: '🏢 Marshall (15 min)' },
                { key: 'nhip15', label: '🏥 NHIP (15 min)' },
                { key: 'toyota15', label: '🚗 Toyota (15 min)' },
              ].map(({ key, label }) => {
                const val15 = parcel[key as keyof Parcel] as string | null;
                const val30 = parcel[(key.replace('15', '30')) as keyof Parcel] as string | null;
                if (!val15 && !val30) return null;
                return (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-xs text-slate-500">
                      {val15 ? '15 min' : val30 ? '30 min' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProspectsPage() {
  const { user, organizationId } = useAuthStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Parcel[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null);
  const [creatingLead, setCreatingLead] = useState<string | null>(null);
  const [savedQuery, setSavedQuery] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live search as user types
  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (q.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.get('/madison/search', {
          params: { q: q.trim(), limit: 20 },
        });
        setResults(res.data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const handleCreateLead = async (parcel: Parcel) => {
    if (!organizationId) return;
    setCreatingLead(parcel.pin);
    try {
      const res = await api.post('/madison/leads', {
        parcelId: parcel.pin,
        address: parcel.propertyAddress,
        source: 'SEARCH',
      });
      // Update the parcel in results with the new lead
      setSelectedParcel({ ...parcel, lead: res.data });
      setResults(prev => prev.map(p => p.pin === parcel.pin ? { ...p, lead: res.data } : p));
    } catch (err) {
      console.error('Failed to create lead:', err);
    } finally {
      setCreatingLead(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-200">Find Prospects</h1>
          <p className="text-sm text-slate-500 mt-1">Search any address in Madison County to find and score leads</p>
        </div>

        {/* Search Bar */}
        <div className="relative mb-6">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            {searching ? (
              <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </div>
          <input
            type="text"
            value={query}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by address or owner name..."
            autoFocus
            className="w-full h-12 pl-12 pr-4 bg-slate-800/80 border border-slate-700/50 rounded-xl text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 focus:bg-slate-800 transition-colors text-sm"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]); }}
              className="absolute inset-y-0 right-3 flex items-center text-slate-500 hover:text-slate-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-600 font-medium">
              {results.length} result{results.length === 20 ? '+' : ''} for &ldquo;{query}&rdquo;
            </p>
            {results.map(parcel => (
              <ParcelCard key={parcel.pin} parcel={parcel} onSelect={setSelectedParcel} />
            ))}
          </div>
        )}

        {/* Empty state — no query */}
        {query.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-slate-400 font-medium mb-2">Search for any property</h3>
            <p className="text-sm text-slate-600 max-w-xs mx-auto">
              Type an address or owner name to find properties in Madison County, AL
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {['SEARCY DR', 'MAPLE DR', 'OAK ST', 'GOLF COURSE'].map(s => (
                <button
                  key={s}
                  onClick={() => handleSearch(s)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 border border-slate-700/50 transition-colors"
                >
                  Try: {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {query.length >= 2 && results.length === 0 && !searching && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🏠</div>
            <h3 className="text-slate-400 font-medium mb-2">No properties found</h3>
            <p className="text-sm text-slate-600">
              Try a different address or owner name
            </p>
          </div>
        )}
      </div>

      {/* Parcel Detail Modal */}
      {selectedParcel && (
        <ParcelDetail
          parcel={selectedParcel}
          onClose={() => setSelectedParcel(null)}
          onCreateLead={handleCreateLead}
        />
      )}
    </div>
  );
}
