'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Search,
  Phone,
  DollarSign,
  CloudRain,
  TrendingUp,
  Flame,
  Target,
  AlertTriangle,
  Zap,
  Mail,
  Map,
  BarChart3,
  ListChecks,
  Tornado,
  Cloud,
  Snowflake,
  Wind,
  Building2,
} from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { getPropertyValue } from '@/lib/propertyValue';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { MobileFieldHome } from '@/components/MobileFieldHome';

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
    marketValue?: number;
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

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'info'
  | 'accent';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  NEW: 'info',
  CONTACTED: 'accent',
  QUALIFIED: 'warning',
  QUOTED: 'info',
  NEGOTIATING: 'accent',
  WON: 'success',
  LOST: 'secondary',
};

const SEVERITY_VARIANT: Record<string, BadgeVariant> = {
  EXTREME: 'destructive',
  SEVERE: 'destructive',
  MODERATE: 'warning',
  LIGHT: 'warning',
};

function ScoreBadge({ score }: { score: number }) {
  const variant: BadgeVariant =
    score >= 75 ? 'success' : score >= 55 ? 'info' : score >= 35 ? 'warning' : 'secondary';
  return (
    <Badge variant={variant} className="tabular-nums">
      {score}
    </Badge>
  );
}

function StormIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'TORNADO') return <Tornado className={className} />;
  if (type === 'HAIL') return <Snowflake className={className} />;
  if (type === 'WIND') return <Wind className={className} />;
  return <Cloud className={className} />;
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
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
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
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derived data
  const hotLeads = leads
    .filter((l) => l.status !== 'WON' && l.status !== 'LOST' && l.score >= 55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const newLeads = leads.filter((l) => l.status === 'NEW');
  const activePipeline = leads.filter((l) => !['WON', 'LOST'].includes(l.status));
  const wonLeads = leads.filter((l) => l.status === 'WON');
  const totalWonValue = wonLeads.reduce((s, l) => s + (l.quotedAmount || 0), 0);

  const recentStorms = storms
    .filter((s) => s.severity === 'EXTREME' || s.severity === 'SEVERE')
    .slice(0, 5);

  const callableLeads = leads
    .filter((l) => l.phone && !['WON', 'LOST'].includes(l.status))
    .sort((a, b) => {
      if (a.priority === 'URGENT' && b.priority !== 'URGENT') return -1;
      if (b.priority === 'URGENT' && a.priority !== 'URGENT') return 1;
      return b.score - a.score;
    })
    .slice(0, 5);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <MobileFieldHome />
      <div className="hidden md:block h-full overflow-y-auto bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{formatDate()}</p>
            <h1 className="mt-0.5 text-2xl font-bold text-[hsl(var(--foreground))]">
              {getGreeting()}
              {user?.firstName ? `, ${user.firstName}` : ''}
            </h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {activePipeline.length} active leads
              {newLeads.length > 0 && (
                <span className="text-[hsl(var(--info))]"> &bull; {newLeads.length} new</span>
              )}
              {wonLeads.length > 0 && (
                <span className="text-[hsl(var(--success))]"> &bull; {wonLeads.length} won</span>
              )}
            </p>
          </div>
          <Button asChild>
            <Link href="/dashboard/prospects">
              <Search className="h-4 w-4" />
              Find Prospects
            </Link>
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Active Pipeline"
            value={activePipeline.length}
            hint={`${newLeads.length} new · ${stats.leads?.won ?? wonLeads.length} won`}
            icon={TrendingUp}
            tone="default"
          />
          <StatCard
            label="Pipeline Value"
            value={formatCurrency(totalWonValue)}
            hint="Closed won jobs"
            icon={DollarSign}
            tone="success"
          />
          <StatCard
            label={`Storms (${stormRange})`}
            value={storms.length}
            hint={`${storms.filter((s) => s.severity === 'EXTREME' || s.severity === 'SEVERE').length} severe+`}
            icon={CloudRain}
            tone="info"
          />
          <StatCard
            label="Callable Now"
            value={callableLeads.length}
            hint="With phone numbers"
            icon={Phone}
            tone="accent"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Left: Hot Leads */}
          <div className="space-y-3 lg:col-span-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--foreground))]">
                <Flame className="h-4 w-4 text-[hsl(var(--destructive))]" />
                Top Prospects
              </h2>
              <Link
                href="/dashboard/pipeline"
                className="text-xs text-[hsl(var(--primary))] transition-colors hover:underline"
              >
                View pipeline →
              </Link>
            </div>

            {hotLeads.length === 0 ? (
              <EmptyState
                icon={Target}
                title="No scored prospects yet"
                description="Search properties to find and score leads"
              />
            ) : (
              <div className="space-y-2">
                {hotLeads.map((lead) => {
                  const name =
                    [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
                  const addr = lead.property?.address || lead.parcelId || 'No address';
                  const statusVariant = STATUS_VARIANT[lead.status] ?? 'secondary';
                  return (
                    <Card
                      key={lead.id}
                      className="p-4 transition-colors hover:border-[hsl(var(--ring))]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                              {name}
                            </p>
                            <ScoreBadge score={lead.score} />
                            <Badge variant={statusVariant}>{lead.status}</Badge>
                          </div>
                          <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                            {addr}
                          </p>
                          {(() => {
                            const v = lead.property ? getPropertyValue(lead.property) : null;
                            return v ? (
                              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                                Property value:{' '}
                                <span className="text-[hsl(var(--foreground))]">
                                  {formatCurrency(v)}
                                </span>
                              </p>
                            ) : null;
                          })()}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {lead.phone ? (
                            <Button asChild size="sm" variant="accent">
                              <a href={`tel:${lead.phone}`}>
                                <Phone className="h-3.5 w-3.5" />
                                Call
                              </a>
                            </Button>
                          ) : (
                            <Button asChild size="sm" variant="secondary">
                              <Link href="/dashboard/prospects">Find #</Link>
                            </Button>
                          )}
                          <Link
                            href="/dashboard/pipeline"
                            className="text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
                          >
                            View →
                          </Link>
                        </div>
                      </div>
                      {lead.notes && (
                        <p className="mt-2 line-clamp-1 text-xs italic text-[hsl(var(--muted-foreground))]">
                          &ldquo;{lead.notes}&rdquo;
                        </p>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Recent Severe Storms */}
            {recentStorms.length > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--foreground))]">
                    <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />
                    Recent Severe Weather
                  </h2>
                  <select
                    value={stormRange}
                    onChange={(e) => setStormRange(e.target.value as '7d' | '30d' | '90d' | 'all')}
                    className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                  >
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                    <option value="90d">90 days</option>
                    <option value="all">All time</option>
                  </select>
                </div>
                <div className="space-y-2">
                  {recentStorms.map((storm) => {
                    const severityVariant = SEVERITY_VARIANT[storm.severity] ?? 'warning';
                    return (
                      <Card
                        key={storm.id}
                        className="flex items-center gap-3 p-3"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                          <StormIcon type={storm.type} className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={severityVariant}>{storm.severity}</Badge>
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">
                              {storm.county || 'Madison County'}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                            {storm.hailSizeInches && (
                              <span>Ice: {storm.hailSizeInches}&quot;</span>
                            )}
                            {storm.windSpeedMph && <span>Wind: {storm.windSpeedMph} mph</span>}
                            <span>
                              {new Date(storm.date).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </div>
                        </div>
                        <Link
                          href={`/dashboard/prospects?q=${storm.county || 'Madison County'}`}
                          className="shrink-0 text-xs text-[hsl(var(--primary))] transition-colors hover:underline"
                        >
                          Find affected →
                        </Link>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right: Callable Leads + Quick Actions */}
          <div className="space-y-4 lg:col-span-2">
            {/* Callable Now */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Phone className="h-4 w-4 text-[hsl(var(--primary))]" />
                  Ready to Call
                </CardTitle>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {callableLeads.length}
                </span>
              </CardHeader>
              <CardContent className="p-0">
                {callableLeads.length === 0 ? (
                  <div className="p-4 text-center text-xs italic text-[hsl(var(--muted-foreground))]">
                    No leads with phone numbers yet
                  </div>
                ) : (
                  <div className="divide-y divide-[hsl(var(--border))]">
                    {callableLeads.map((lead) => {
                      const name =
                        [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
                      return (
                        <div
                          key={lead.id}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm text-[hsl(var(--foreground))]">
                                {name}
                              </p>
                              {lead.priority === 'URGENT' && (
                                <Zap className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--destructive))]" />
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                                {lead.phone}
                              </span>
                              <ScoreBadge score={lead.score} />
                            </div>
                          </div>
                          <Button asChild size="icon" variant="accent" className="h-8 w-8 shrink-0">
                            <a href={`tel:${lead.phone}`}>
                              <Phone className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="border-t border-[hsl(var(--border))] px-4 py-2">
                  <Link
                    href="/dashboard/pipeline"
                    className="text-xs text-[hsl(var(--primary))] transition-colors hover:underline"
                  >
                    Full pipeline →
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Zap className="h-4 w-4 text-[hsl(var(--accent))]" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 p-3 pt-0">
                {[
                  {
                    href: '/dashboard/prospects',
                    icon: Search,
                    title: 'Find Prospects',
                    desc: 'Search Madison County properties',
                  },
                  {
                    href: '/dashboard/canvassing',
                    icon: Map,
                    title: 'Canvassing Mode',
                    desc: 'Route through neighborhoods',
                  },
                  {
                    href: '/dashboard/pipeline',
                    icon: BarChart3,
                    title: 'Lead Pipeline',
                    desc: 'Manage your sales pipeline',
                  },
                  {
                    href: '/dashboard/leads',
                    icon: ListChecks,
                    title: 'All Leads',
                    desc: 'Table view with filters',
                  },
                ].map(({ href, icon: Icon, title, desc }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[hsl(var(--muted))]"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] transition-colors group-hover:bg-[hsl(var(--primary)/0.1)] group-hover:text-[hsl(var(--primary))]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[hsl(var(--foreground))]">{title}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">{desc}</p>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>

            {/* New This Week */}
            {newLeads.length > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center gap-2 space-y-0 p-4">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--info))]" />
                  <CardTitle className="text-sm font-semibold">
                    New Leads This Session
                  </CardTitle>
                  <span className="ml-auto text-xs text-[hsl(var(--info))]">{newLeads.length}</span>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-[hsl(var(--border))]">
                    {newLeads.slice(0, 5).map((lead) => {
                      const name =
                        [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown';
                      return (
                        <div key={lead.id} className="px-4 py-3">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-[hsl(var(--foreground))]">
                                {name}
                              </p>
                              <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                                {lead.parcelId ? `Parcel ${lead.parcelId}` : lead.source}
                              </p>
                            </div>
                            <ScoreBadge score={lead.score} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
