'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

interface Lead {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  status: string;
  priority: string;
  score: number;
  source?: string;
  notes?: string;
  parcelId?: string;
  createdAt: string;
  quotedAmount?: number | null;
  assigneeId?: string | null;
  property?: {
    address?: string;
    city?: string;
    state?: string;
    yearBuilt?: number;
    ownerFullName?: string;
    assessedValue?: number;
  };
}

interface StormEvent {
  id: string;
  type: string;
  severity: string;
  date: string;
  lat: number;
  lon: number;
  hailSizeInches?: number;
  windSpeedMph?: number;
  county?: string;
}

interface Stats {
  leads?: { total?: number; new?: number; won?: number };
  properties?: { total?: number };
  storms?: { last7Days?: number; last30Days?: number };
  pipelineValue?: number;
}

const STATUS_CONFIG = {
  NEW: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  CONTACTED: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  QUALIFIED: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  QUOTED: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  NEGOTIATING: { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30' },
  WON: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  LOST: { bg: 'bg-slate-500/20', text: 'text-slate-700 dark:text-slate-600 dark:text-slate-500 dark:text-slate-400', border: 'border-slate-500/30' },
};

const SEVERITY_COLOR: Record<string, string> = {
  EXTREME: 'text-red-400 bg-red-500/20',
  SEVERE: 'text-orange-400 bg-orange-500/20',
  MODERATE: 'text-amber-400 bg-amber-500/20',
  LIGHT: 'text-yellow-400 bg-yellow-500/20',
};

function ScoreBadge({ score }: { score: number }) {
  if (score >= 75) return <span className="text-xs font-bold text-emerald-400">{score}</span>;
  if (score >= 55) return <span className="text-xs font-bold text-cyan-400">{score}</span>;
  if (score >= 35) return <span className="text-xs font-bold text-amber-400">{score}</span>;
  return <span className="text-xs font-bold text-slate-700 dark:text-slate-600 dark:text-slate-500">{score}</span>;
}

function formatCurrency(v: number) {
  if (!v) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [storms, setStorms] = useState<StormEvent[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [stormRange, setStormRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  const fetchData = useCallback(async () => {
    if (!user?.orgId) return;
    try {
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, all: 9999 };
      const days = daysMap[stormRange];
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [leadsRes, stormsRes, statsRes] = await Promise.all([
        api.get('/leads', { params: { limit: 100 } }).catch(() => ({ data: [] })),
        api.get('/storms', { params: { since, limit: 50 } }).catch(() => ({ data: [] })),
        api.get('/analytics/overview').catch(() => ({ data: {} })),
      ]);

      setLeads(Array.isArray(leadsRes.data) ? leadsRes.data : []);
      setStorms(Array.isArray(stormsRes.data) ? stormsRes.data : []);
      setStats(statsRes.data || {});
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user?.orgId, stormRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Derived data
  const hotLeads = leads
    .filter(l => l.status !== 'WON' && l.status !== 'LOST' && l.score >= 55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const newLeads = leads.filter(l => l.status === 'NEW');
  const activePipeline = leads.filter(l => !['WON', 'LOST'].includes(l.status));
  const wonLeads = leads.filter(l => l.status === 'WON');
  const totalWonValue = wonLeads.reduce((s, l) => s + (l.quotedAmount || 0), 0);

  const recentStorms = storms
    .filter(s => s.severity === 'EXTREME' || s.severity === 'SEVERE')
    .slice(0, 5);

  const callableLeads = leads
    .filter(l => l.phone && !['WON', 'LOST'].includes(l.status))
    .sort((a, b) => {
      if (a.priority === 'URGENT' && b.priority !== 'URGENT') return -1;
      if (b.priority === 'URGENT' && a.priority !== 'URGENT') return 1;
      return b.score - a.score;
    })
    .slice(0, 5);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-700 dark:text-slate-600 dark:text-slate-500">{formatDate()}</p>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
              {getGreeting()}{user?.firstName ? `, ${user.firstName}` : ''}
            </h1>
            <p className="text-sm text-slate-700 dark:text-slate-600 dark:text-slate-500 mt-1">
              {activePipeline.length} active leads &bull;
              {newLeads.length > 0 && <span className="text-blue-400"> {newLeads.length} new</span>}
              {wonLeads.length > 0 && <span className="text-emerald-400"> &bull; {wonLeads.length} won</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/prospects"
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-900 dark:text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Find Prospects
            </Link>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-600 dark:text-slate-500 uppercase tracking-wider">Active Pipeline</span>
              <span className="text-lg">📈</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{activePipeline.length}</p>
            <p className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500 mt-1">
              {newLeads.length} new &bull; {stats.leads?.won || wonLeads.length} won
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-600 dark:text-slate-500 uppercase tracking-wider">Pipeline Value</span>
              <span className="text-lg">💰</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatCurrency(totalWonValue)}</p>
            <p className="text-xs text-emerald-400/70 mt-1">Closed won jobs</p>
          </div>

          <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-600 dark:text-slate-500 uppercase tracking-wider">Storms ({stormRange})</span>
              <span className="text-lg">🌩️</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{storms.length}</p>
            <p className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500 mt-1">
              {storms.filter(s => s.severity === 'EXTREME' || s.severity === 'SEVERE').length} severe+
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-600 dark:text-slate-500 uppercase tracking-wider">Callable Now</span>
              <span className="text-lg">📞</span>
            </div>
            <p className="text-2xl font-bold text-cyan-400">{callableLeads.length}</p>
            <p className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500 mt-1">With phone numbers</p>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Left: Hot Leads */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">🔥 Top Prospects</h2>
              <Link href="/dashboard/pipeline" className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
                View pipeline →
              </Link>
            </div>

            {hotLeads.length === 0 ? (
              <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50 rounded-xl p-8 text-center">
                <div className="text-3xl mb-3">🎯</div>
                <p className="text-slate-700 dark:text-slate-600 dark:text-slate-500 dark:text-slate-400 font-medium mb-1">No scored prospects yet</p>
                <p className="text-xs text-slate-700 dark:text-slate-600 mb-4">Search properties to find and score leads</p>
                <Link href="/dashboard/prospects" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">
                  Find prospects →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {hotLeads.map(lead => {
                  const cfg = STATUS_CONFIG[lead.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.NEW;
                  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
                  const addr = lead.property?.address || lead.parcelId || 'No address';
                  return (
                    <div key={lead.id} className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl p-4 hover:border-slate-300 dark:border-slate-600 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{name}</p>
                            <ScoreBadge score={lead.score} />
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
                              {lead.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500 truncate">{addr}</p>
                          {lead.property?.assessedValue && (
                            <p className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500 dark:text-slate-400 mt-1">
                              Property value: <span className="text-slate-700 dark:text-slate-300">{formatCurrency(lead.property.assessedValue)}</span>
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {lead.phone ? (
                            <a
                              href={`tel:${lead.phone}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 text-xs font-semibold rounded-lg transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                              Call
                            </a>
                          ) : (
                            <Link
                              href="/dashboard/prospects"
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-700 text-slate-700 dark:text-slate-600 dark:text-slate-500 dark:text-slate-400 text-xs font-medium rounded-lg transition-colors"
                            >
                              Find #
                            </Link>
                          )}
                          <Link
                            href="/dashboard/pipeline"
                            className="text-xs text-slate-700 dark:text-slate-600 hover:text-slate-700 dark:text-slate-600 dark:text-slate-500 dark:text-slate-400 transition-colors"
                          >
                            View →
                          </Link>
                        </div>
                      </div>
                      {lead.notes && (
                        <p className="text-xs text-slate-700 dark:text-slate-600 mt-2 italic line-clamp-1">"{lead.notes}"</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent Severe Storms */}
            {recentStorms.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">⚠️ Recent Severe Weather</h2>
                  <select
                    value={stormRange}
                    onChange={e => setStormRange(e.target.value as any)}
                    className="text-xs bg-slate-800 border border-slate-700 text-slate-700 dark:text-slate-600 dark:text-slate-500 dark:text-slate-400 rounded px-2 py-1"
                  >
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                    <option value="90d">90 days</option>
                    <option value="all">All time</option>
                  </select>
                </div>
                <div className="space-y-2">
                  {recentStorms.map(storm => (
                    <div key={storm.id} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50 rounded-lg p-3 flex items-center gap-3">
                      <div className="text-xl">
                        {storm.type === 'HAIL' ? '🧊' : storm.type === 'TORNADO' ? '🌪️' : '💨'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${SEVERITY_COLOR[storm.severity] || SEVERITY_COLOR.LIGHT}`}>
                            {storm.severity}
                          </span>
                          <span className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500 dark:text-slate-400">{storm.county || 'Madison County'}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          {storm.hailSizeInches && (
                            <span className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500">Ice: {storm.hailSizeInches}"</span>
                          )}
                          {storm.windSpeedMph && (
                            <span className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500">Wind: {storm.windSpeedMph} mph</span>
                          )}
                          <span className="text-xs text-slate-700 dark:text-slate-600">
                            {new Date(storm.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>
                      <Link
                        href={`/dashboard/prospects?q=${storm.county || 'Madison County'}`}
                        className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors shrink-0"
                      >
                        Find affected →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Callable Leads + Quick Actions */}
          <div className="lg:col-span-2 space-y-4">

            {/* Callable Now */}
            <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">📞 Ready to Call</h3>
                <span className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500">{callableLeads.length}</span>
              </div>
              <div className="divide-y divide-slate-700/30">
                {callableLeads.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-700 dark:text-slate-600 italic">
                    No leads with phone numbers yet
                  </div>
                ) : (
                  callableLeads.map(lead => {
                    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
                    return (
                      <div key={lead.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-slate-800 dark:text-slate-200 truncate">{name}</p>
                            {lead.priority === 'URGENT' && (
                              <span className="text-xs text-red-400 font-bold shrink-0">⚡</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-700 dark:text-slate-600 dark:text-slate-500 truncate">{lead.phone}</span>
                            <ScoreBadge score={lead.score} />
                          </div>
                        </div>
                        <a
                          href={`tel:${lead.phone}`}
                          className="shrink-0 w-8 h-8 flex items-center justify-center bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 rounded-lg transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                        </a>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700/50">
                <Link href="/dashboard/pipeline" className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
                  Full pipeline →
                </Link>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">⚡ Quick Actions</h3>
              </div>
              <div className="p-3 space-y-2">
                <Link href="/dashboard/prospects" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700/40 transition-colors group">
                  <span className="text-lg">🔍</span>
                  <div>
                    <p className="text-sm text-slate-800 dark:text-slate-200 font-medium group-hover:text-slate-900 dark:text-white transition-colors">Find Prospects</p>
                    <p className="text-xs text-slate-700 dark:text-slate-600">Search Madison County properties</p>
                  </div>
                </Link>
                <Link href="/dashboard/canvassing" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700/40 transition-colors group">
                  <span className="text-lg">🗺️</span>
                  <div>
                    <p className="text-sm text-slate-800 dark:text-slate-200 font-medium group-hover:text-slate-900 dark:text-white transition-colors">Canvassing Mode</p>
                    <p className="text-xs text-slate-700 dark:text-slate-600">Route through neighborhoods</p>
                  </div>
                </Link>
                <Link href="/dashboard/pipeline" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700/40 transition-colors group">
                  <span className="text-lg">📊</span>
                  <div>
                    <p className="text-sm text-slate-800 dark:text-slate-200 font-medium group-hover:text-slate-900 dark:text-white transition-colors">Lead Pipeline</p>
                    <p className="text-xs text-slate-700 dark:text-slate-600">Manage your sales pipeline</p>
                  </div>
                </Link>
                <Link href="/dashboard/leads" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700/40 transition-colors group">
                  <span className="text-lg">📋</span>
                  <div>
                    <p className="text-sm text-slate-800 dark:text-slate-200 font-medium group-hover:text-slate-900 dark:text-white transition-colors">All Leads</p>
                    <p className="text-xs text-slate-700 dark:text-slate-600">Table view with filters</p>
                  </div>
                </Link>
              </div>
            </div>

            {/* New This Week */}
            {newLeads.length > 0 && (
              <div className="bg-white dark:bg-slate-800/60 border border-blue-500/20 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50 flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">New Leads This Session</h3>
                  <span className="text-xs text-blue-400 ml-auto">{newLeads.length}</span>
                </div>
                <div className="divide-y divide-slate-700/30">
                  {newLeads.slice(0, 5).map(lead => {
                    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
                    return (
                      <div key={lead.id} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-slate-800 dark:text-slate-200">{name}</p>
                            <p className="text-xs text-slate-700 dark:text-slate-600 mt-0.5">{lead.parcelId ? `Parcel ${lead.parcelId}` : lead.source}</p>
                          </div>
                          <ScoreBadge score={lead.score} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
