'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

interface CanvassingItem {
  order: number;
  leadId: string;
  score: number;
  priority: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  yearBuilt: number | null;
  roofAge: number | null;
  roofAgeSource: 'measured' | 'coc' | 'permit' | 'inferred' | 'unknown';
  roofMaterial: string | null;
  estimatedRoofSqft: number | null;
  estimatedJobValue: number | null;
  medianHomeValue: number | null;
  ownerName: string | null;
  distanceFromStormKm: number;
  stormSeverity: string | null;
  assignee: string | null;
  notes: string | null;
}

interface Storm {
  id: string;
  type: string;
  severity: string;
  date: string;
  city?: string;
  county?: string;
  lat?: number;
  lon?: number;
}

export default function CanvassingPage() {
  const { user } = useAuthStore();
  const [storms, setStorms] = useState<Storm[]>([]);
  const [selectedStorm, setSelectedStorm] = useState<string>('');
  const [radius, setRadius] = useState(15);
  const [canvassingList, setCanvassingList] = useState<CanvassingItem[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [stormsLoading, setStormsLoading] = useState(true);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Load recent storms for selection
  useEffect(() => {
    const fetchStorms = async () => {
      try {
        const res = await api.get('/storms', { params: { limit: 30, state: 'AL' } });
        setStorms(res.data.data || []);
      } catch (error) {
        console.error('Failed to load storms:', error);
      } finally {
        setStormsLoading(false);
      }
    };
    fetchStorms();
  }, []);

  const generateList = async () => {
    if (!selectedStorm) return;
    setLoading(true);
    try {
      const res = await api.get('/leads/canvassing', {
        params: { stormId: selectedStorm, radius, limit: 50 },
      });
      setCanvassingList(res.data.list || []);
      setMeta(res.data.meta || null);
    } catch (error) {
      console.error('Failed to generate canvassing list:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'bg-red-100 text-red-800';
      case 'HIGH': return 'bg-orange-100 text-orange-800';
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-800';
      case 'LOW': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getSeverityColor = (severity: string | null) => {
    switch (severity) {
      case 'EXTREME': return 'bg-red-500';
      case 'SEVERE': return 'bg-orange-500';
      case 'MODERATE': return 'bg-yellow-500';
      case 'LIGHT': return 'bg-green-500';
      default: return 'bg-gray-400';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 50) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    if (score >= 25) return 'text-orange-600 bg-orange-50 border-orange-200';
    return 'text-gray-600 bg-gray-50 border-gray-200';
  };

  const formatCurrency = (value: number | null) => {
    if (!value) return '—';
    return '$' + value.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <h1 className="text-lg font-bold text-gray-900">Canvassing List</h1>
          <p className="text-sm text-gray-500">Generate optimized door-knocking routes</p>
        </div>
      </div>

      {/* Storm Selection */}
      <div className="max-w-4xl mx-auto px-4 py-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Select Storm Event</label>
              <select
                value={selectedStorm}
                onChange={(e) => setSelectedStorm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={stormsLoading}
              >
                <option value="">
                  {stormsLoading ? 'Loading storms...' : 'Choose a storm...'}
                </option>
                {storms.map((storm) => (
                  <option key={storm.id} value={storm.id}>
                    {storm.type} — {storm.city || storm.county || 'Unknown'} — {new Date(storm.date).toLocaleDateString()} ({storm.severity})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium text-gray-500 mb-1">Radius (km)</label>
              <input
                type="number"
                value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value) || 15)}
                min={1}
                max={100}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={generateList}
                disabled={!selectedStorm || loading}
                className="w-full sm:w-auto px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating...
                  </span>
                ) : 'Generate List'}
              </button>
            </div>
          </div>
        </div>

        {/* Storm Info Banner */}
        {meta?.stormInfo && (
          <div className="mt-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${getSeverityColor(meta.stormInfo.severity)}`} />
            <div className="text-sm">
              <span className="font-semibold text-orange-900">
                {meta.stormInfo.type} Storm
              </span>
              <span className="text-orange-700 ml-2">
                {meta.stormInfo.city || meta.stormInfo.county} — {new Date(meta.stormInfo.date).toLocaleDateString()}
              </span>
            </div>
            <div className="ml-auto text-sm font-bold text-orange-900">
              {meta.total} leads found
            </div>
          </div>
        )}

        {/* Canvassing List */}
        {canvassingList.length > 0 && (
          <div className="mt-4 space-y-2">
            {/* Print header */}
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-700">
                Door-Knocking Order
              </h2>
              <button
                onClick={() => window.print()}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print
              </button>
            </div>

            {canvassingList.map((item) => (
              <div
                key={item.leadId}
                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
              >
                {/* Main row - always visible */}
                <button
                  onClick={() => setExpandedItem(expandedItem === item.leadId ? null : item.leadId)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
                >
                  {/* Order number */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                    {item.order}
                  </div>

                  {/* Address & name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {item.address}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.city}, {item.state} {item.zip}
                      {item.ownerName && ` — ${item.ownerName}`}
                      {!item.ownerName && item.firstName && ` — ${item.firstName} ${item.lastName || ''}`}
                    </p>
                  </div>

                  {/* Score badge */}
                  <div className={`flex-shrink-0 px-2 py-1 rounded-lg border text-xs font-bold ${getScoreColor(item.score)}`}>
                    {item.score}
                  </div>

                  {/* Distance */}
                  <div className="flex-shrink-0 text-xs text-gray-400 w-14 text-right">
                    {item.distanceFromStormKm} km
                  </div>

                  {/* Expand arrow */}
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${expandedItem === item.leadId ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded details */}
                {expandedItem === item.leadId && (
                  <div className="px-4 pb-4 pt-1 border-t border-gray-100">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      {/* Contact */}
                      {(item.phone || item.email) && (
                        <div>
                          <p className="text-gray-500 font-medium mb-1">Contact</p>
                          {item.phone && (
                            <a href={`tel:${item.phone}`} className="text-blue-600 font-medium block">
                              {item.phone}
                            </a>
                          )}
                          {item.email && (
                            <a href={`mailto:${item.email}`} className="text-blue-600 block truncate">
                              {item.email}
                            </a>
                          )}
                        </div>
                      )}

                      {/* Property */}
                      <div>
                        <p className="text-gray-500 font-medium mb-1">Property</p>
                        {item.yearBuilt && <p>Built: {item.yearBuilt}</p>}
                        {item.roofAge !== null && (
                          <p
                            className={
                              item.roofAge >= 20 && (item.roofAgeSource === 'measured' || item.roofAgeSource === 'coc' || item.roofAgeSource === 'permit')
                                ? 'text-red-600 font-semibold'
                                : item.roofAge >= 20
                                  ? 'text-red-500'
                                  : ''
                            }
                            title={item.roofAgeSource === 'inferred' ? 'Estimated from year built' : undefined}
                          >
                            Roof age: {item.roofAge} yrs{item.roofAgeSource === 'inferred' ? ' (est.)' : ''}
                          </p>
                        )}
                        {item.roofMaterial && <p>Material: {item.roofMaterial}</p>}
                      </div>

                      {/* Value */}
                      <div>
                        <p className="text-gray-500 font-medium mb-1">Estimated Value</p>
                        <p className="font-semibold text-green-700">
                          Job: {formatCurrency(item.estimatedJobValue)}
                        </p>
                        {item.estimatedRoofSqft && (
                          <p>Roof: {Math.round(item.estimatedRoofSqft).toLocaleString()} sqft</p>
                        )}
                        {item.medianHomeValue && (
                          <p>Area value: {formatCurrency(item.medianHomeValue)}</p>
                        )}
                      </div>

                      {/* Storm context */}
                      <div>
                        <p className="text-gray-500 font-medium mb-1">Storm</p>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${getSeverityColor(item.stormSeverity)}`} />
                          <span>{item.stormSeverity || 'Unknown'} severity</span>
                        </div>
                        <p>{item.distanceFromStormKm} km from center</p>
                      </div>

                      {/* Status */}
                      <div>
                        <p className="text-gray-500 font-medium mb-1">Status</p>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${getPriorityColor(item.priority)}`}>
                          {item.priority}
                        </span>
                        <p className="mt-1">{item.status}</p>
                        {item.assignee && <p>Assigned: {item.assignee}</p>}
                      </div>

                      {/* Notes */}
                      {item.notes && (
                        <div className="col-span-2 sm:col-span-3">
                          <p className="text-gray-500 font-medium mb-1">Notes</p>
                          <p className="text-gray-600">{item.notes}</p>
                        </div>
                      )}
                    </div>

                    {/* Quick actions */}
                    <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                      {item.phone && (
                        <a
                          href={`tel:${item.phone}`}
                          className="flex-1 text-center py-2 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 transition-colors"
                        >
                          Call
                        </a>
                      )}
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(item.address + ', ' + item.city + ', ' + item.state + ' ' + item.zip)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors"
                      >
                        Navigate
                      </a>
                      {item.email && (
                        <a
                          href={`mailto:${item.email}`}
                          className="flex-1 text-center py-2 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors"
                        >
                          Email
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && canvassingList.length === 0 && selectedStorm && meta && (
          <div className="mt-8 text-center py-12">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <p className="text-gray-500 font-medium">No leads found in this area</p>
            <p className="text-gray-400 text-sm mt-1">Try increasing the radius or selecting a different storm</p>
          </div>
        )}

        {/* Initial state */}
        {!meta && canvassingList.length === 0 && !loading && (
          <div className="mt-8 text-center py-12">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-gray-500 font-medium">Select a storm to generate your canvassing list</p>
            <p className="text-gray-400 text-sm mt-1">Leads will be ranked by score and proximity</p>
          </div>
        )}
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          .sticky { position: relative !important; }
          button, a[href^="tel"], a[href^="mailto"], a[href*="google.com/maps"] { display: none !important; }
          .bg-white { box-shadow: none !important; border: 1px solid #e5e7eb !important; }
        }
      `}</style>
    </div>
  );
}
