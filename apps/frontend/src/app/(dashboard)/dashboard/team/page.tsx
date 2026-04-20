'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  DollarSign,
  Flame,
  Gauge,
  MapPinned,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

// ----- types (loosely typed to match backend shape) ------------------------

interface Rep {
  userId: string;
  name: string;
  leadsAssigned: number;
  contacted: number;
  quoted: number;
  won: number;
  lost: number;
  revenue: number;
  avgTicket: number;
  avgHoursToContact: number | null;
  doorsKnocked: number;
  closeRate: number;
  contactRate: number;
}

interface PipelineVelocity {
  stages: Record<string, { count: number; medianDaysInStage: number | null }>;
  funnel: {
    contactRate: number;
    quoteRate: number;
    closeRate: number;
    overallCloseRate: number;
  };
}

interface LeadDecay {
  uncontacted24h: number;
  uncontacted48h: number;
  stuckDeals: number;
  activeByStage: Record<string, number>;
  topOverdue: Array<{
    leadId: string;
    displayName: string;
    status: string;
    daysSinceUpdate: number;
    address: string | null;
  }>;
}

interface TerritoryEquity {
  territories: Array<{
    territoryId: string;
    name: string;
    repCount: number;
    opportunityCount: number;
    opportunityPerRep: number;
    imbalanceFlag: boolean;
  }>;
  maxMinRatio: number;
}

interface RevenueForecast {
  byStage: Record<string, { count: number; value: number; probability: number; weighted: number }>;
  total30: number;
  total60: number;
  total90: number;
  winRate180d: number;
}

export default function TeamDashboardPage() {
  const [leaderboard, setLeaderboard] = useState<Rep[] | null>(null);
  const [velocity, setVelocity] = useState<PipelineVelocity | null>(null);
  const [decay, setDecay] = useState<LeadDecay | null>(null);
  const [equity, setEquity] = useState<TerritoryEquity | null>(null);
  const [forecast, setForecast] = useState<RevenueForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [lb, pv, ld, te, rf] = await Promise.all([
          api.get<Rep[]>(`/analytics/team/leaderboard?days=${days}`),
          api.get<PipelineVelocity>(`/analytics/pipeline/velocity?days=${days}`),
          api.get<LeadDecay>('/analytics/leads/decay'),
          api.get<TerritoryEquity>('/analytics/territory/equity'),
          api.get<RevenueForecast>('/analytics/forecast/revenue'),
        ]);
        if (cancelled) return;
        setLeaderboard(lb.data);
        setVelocity(pv.data);
        setDecay(ld.data);
        setEquity(te.data);
        setForecast(rf.data);
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const topRep = leaderboard && leaderboard.length > 0 ? leaderboard[0] : null;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="w-6 h-6 text-[hsl(var(--primary))]" />
            Team Performance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Leaderboard, pipeline velocity, lead decay, and territory equity in one view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                'text-xs font-medium rounded-full px-3 py-1 border transition-colors',
                days === d
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]'
                  : 'bg-transparent text-muted-foreground border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label={`Revenue (last ${days}d)`}
          value={fmtUsd(leaderboard?.reduce((s, r) => s + r.revenue, 0) ?? 0)}
          tone="success"
          icon={DollarSign}
        />
        <StatCard
          label="Active pipeline"
          value={sumActive(velocity).toLocaleString()}
          hint={velocity ? `${pct(velocity.funnel.overallCloseRate)} close rate` : undefined}
          tone="accent"
          icon={Activity}
        />
        <StatCard
          label="Uncontacted > 48h"
          value={(decay?.uncontacted48h ?? 0).toLocaleString()}
          tone={(decay?.uncontacted48h ?? 0) > 0 ? 'destructive' : 'success'}
          icon={Clock}
        />
        <StatCard
          label="Weighted forecast (30d)"
          value={fmtUsd(forecast?.total30 ?? 0)}
          tone="info"
          icon={TrendingUp}
        />
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[hsl(var(--accent))]" />
            Rep Leaderboard · last {days}d
          </CardTitle>
          {topRep && (
            <Badge variant="accent" className="text-xs">
              Top: {topRep.name} · {fmtUsd(topRep.revenue)}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {!leaderboard ? (
            <SkeletonRows />
          ) : leaderboard.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No rep activity yet"
              description="Leaderboard populates once reps start logging contacts and wins."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-[hsl(var(--border))]">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Rep</th>
                    <th className="text-right px-3 py-2 font-medium">Leads</th>
                    <th className="text-right px-3 py-2 font-medium">Contacted</th>
                    <th className="text-right px-3 py-2 font-medium">Quoted</th>
                    <th className="text-right px-3 py-2 font-medium">Won</th>
                    <th className="text-right px-3 py-2 font-medium">Revenue</th>
                    <th className="text-right px-3 py-2 font-medium">Close%</th>
                    <th className="text-right px-3 py-2 font-medium">Avg hrs to contact</th>
                    <th className="text-right px-4 py-2 font-medium">Doors</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((r, idx) => (
                    <tr key={r.userId} className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--muted))]/40">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold',
                              idx === 0 && 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]',
                              idx === 1 && 'bg-[hsl(var(--muted-foreground))]/30 text-foreground',
                              idx === 2 && 'bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]',
                              idx > 2 && 'bg-[hsl(var(--muted))] text-muted-foreground',
                            )}
                          >
                            {idx + 1}
                          </span>
                          <span className="font-medium">{r.name}</span>
                        </div>
                      </td>
                      <td className="text-right px-3 py-2.5">{r.leadsAssigned}</td>
                      <td className="text-right px-3 py-2.5">{r.contacted}</td>
                      <td className="text-right px-3 py-2.5">{r.quoted}</td>
                      <td className="text-right px-3 py-2.5 font-semibold text-[hsl(var(--success))]">{r.won}</td>
                      <td className="text-right px-3 py-2.5 font-semibold">{fmtUsd(r.revenue)}</td>
                      <td className="text-right px-3 py-2.5">{pct(r.closeRate)}</td>
                      <td className="text-right px-3 py-2.5">
                        {r.avgHoursToContact != null ? r.avgHoursToContact.toFixed(1) : '—'}
                      </td>
                      <td className="text-right px-4 py-2.5">{r.doorsKnocked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline Velocity & Forecast side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Gauge className="w-4 h-4 text-[hsl(var(--info))]" />
              Pipeline Velocity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!velocity ? (
              <SkeletonRows />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <FunnelStat label="Contact rate" v={velocity.funnel.contactRate} />
                  <FunnelStat label="Quote rate" v={velocity.funnel.quoteRate} />
                  <FunnelStat label="Close rate" v={velocity.funnel.closeRate} />
                  <FunnelStat label="Overall close" v={velocity.funnel.overallCloseRate} />
                </div>
                <div className="space-y-1.5 pt-2 border-t border-[hsl(var(--border))]">
                  {Object.entries(velocity.stages).map(([stage, info]) => (
                    <StageBar
                      key={stage}
                      stage={stage}
                      count={info.count}
                      median={info.medianDaysInStage}
                      max={Math.max(...Object.values(velocity.stages).map((s) => s.count), 1)}
                    />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[hsl(var(--success))]" />
              Revenue Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!forecast ? (
              <SkeletonRows />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <ForecastTile label="30 days" value={forecast.total30} />
                  <ForecastTile label="60 days" value={forecast.total60} />
                  <ForecastTile label="90 days" value={forecast.total90} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Weighted by 180d historical win-rate of{' '}
                  <span className="font-medium text-foreground">{pct(forecast.winRate180d)}</span>.
                </p>
                <div className="space-y-1.5 pt-2 border-t border-[hsl(var(--border))]">
                  {Object.entries(forecast.byStage).map(([stage, info]) => (
                    <div key={stage} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{stageLabel(stage)}</span>
                      <span className="font-mono text-xs">
                        {info.count} × {fmtUsd(info.value / Math.max(info.count, 1))} · p={pct(info.probability)} ·{' '}
                        <span className="font-semibold text-foreground">{fmtUsd(info.weighted)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lead decay + Territory equity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Flame className="w-4 h-4 text-[hsl(var(--destructive))]" />
              Lead Decay
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!decay ? (
              <SkeletonRows />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <DecayTile label=">24h uncontacted" value={decay.uncontacted24h} tone="warning" />
                  <DecayTile label=">48h uncontacted" value={decay.uncontacted48h} tone="destructive" />
                  <DecayTile label="Stuck > 14d" value={decay.stuckDeals} tone="destructive" />
                </div>
                <div className="space-y-1 pt-2 border-t border-[hsl(var(--border))]">
                  {decay.topOverdue.slice(0, 6).map((l) => (
                    <div key={l.leadId} className="flex items-center justify-between text-sm gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{l.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">{l.address || '—'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="outline" className="text-[10px]">
                          {stageLabel(l.status)}
                        </Badge>
                        <p className="text-xs text-[hsl(var(--destructive))] mt-0.5">
                          {l.daysSinceUpdate}d
                        </p>
                      </div>
                    </div>
                  ))}
                  {decay.topOverdue.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No overdue leads — nice.</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <MapPinned className="w-4 h-4 text-[hsl(var(--accent))]" />
              Territory Equity
            </CardTitle>
            {equity && equity.maxMinRatio > 2 && (
              <Badge variant="warning" className="text-xs inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Imbalance
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {!equity ? (
              <SkeletonRows />
            ) : equity.territories.length === 0 ? (
              <EmptyState icon={MapPinned} title="No territories defined yet" />
            ) : (
              <div className="space-y-1.5">
                {equity.territories.map((t) => (
                  <div key={t.territoryId} className="flex items-center justify-between text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.repCount} rep{t.repCount === 1 ? '' : 's'} · {t.opportunityCount} opps
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-xs">
                        {t.opportunityPerRep.toFixed(0)} / rep
                      </p>
                      {t.imbalanceFlag && (
                        <Badge variant="warning" className="text-[10px] mt-0.5">
                          imbalanced
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ----- small building blocks -----------------------------------------------

function SkeletonRows() {
  return (
    <div className="space-y-2 p-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-6 rounded bg-[hsl(var(--muted))] animate-pulse" />
      ))}
    </div>
  );
}

function FunnelStat({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-[hsl(var(--muted))] px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{pct(v)}</span>
    </div>
  );
}

function StageBar({
  stage,
  count,
  median,
  max,
}: {
  stage: string;
  count: number;
  median: number | null;
  max: number;
}) {
  const width = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{stageLabel(stage)}</span>
        <span>
          {count}
          {median != null && (
            <span className="text-muted-foreground"> · {median.toFixed(1)}d</span>
          )}
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
        <div className="h-full bg-[hsl(var(--primary))]" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ForecastTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{fmtUsd(value)}</p>
    </div>
  );
}

function DecayTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'warning' | 'destructive' | 'success';
}) {
  const color =
    value === 0
      ? 'text-[hsl(var(--success))]'
      : tone === 'destructive'
        ? 'text-[hsl(var(--destructive))]'
        : 'text-[hsl(var(--warning))]';
  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-semibold', color)}>{value}</p>
    </div>
  );
}

// ----- helpers --------------------------------------------------------------

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function pct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function stageLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function sumActive(v: PipelineVelocity | null): number {
  if (!v) return 0;
  const closed = new Set(['WON', 'LOST']);
  return Object.entries(v.stages)
    .filter(([k]) => !closed.has(k))
    .reduce((s, [, info]) => s + info.count, 0);
}
