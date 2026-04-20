'use client';

import { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Trophy,
  TrendingUp,
  Home,
  CloudRain,
} from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { cn } from '@/lib/utils';

interface OverviewStats {
  leads: { total: number; new: number; won: number; conversionRate: number };
  properties: { total: number };
  storms: { last30Days: number };
}

interface MonthlyData {
  month: string;
  total: number;
  won: number;
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [overviewRes, monthlyRes] = await Promise.all([
          api.get('/analytics/overview'),
          api.get('/analytics/leads-by-month', { params: { months: 6 } }),
        ]);
        setOverview(overviewRes.data);
        setMonthly(monthlyRes.data || []);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
      </div>
    );
  }

  // Simple bar chart using divs
  const maxMonthly = Math.max(...monthly.map((m) => m.total), 1);

  // Conversion funnel (estimated from overview)
  const totalLeads = overview?.leads.total || 0;
  const funnelStages: {
    label: string;
    count: number;
    tone: 'info' | 'accent' | 'warning' | 'default' | 'success';
  }[] = [
    { label: 'Total Leads', count: totalLeads, tone: 'info' },
    { label: 'Contacted', count: Math.round(totalLeads * 0.6), tone: 'accent' },
    { label: 'Qualified', count: Math.round(totalLeads * 0.35), tone: 'warning' },
    { label: 'Quoted', count: Math.round(totalLeads * 0.2), tone: 'default' },
    { label: 'Won', count: overview?.leads.won || 0, tone: 'success' },
  ];

  const toneBar: Record<(typeof funnelStages)[number]['tone'], string> = {
    info: 'bg-[hsl(var(--info))]',
    accent: 'bg-[hsl(var(--accent))]',
    warning: 'bg-[hsl(var(--warning))]',
    default: 'bg-[hsl(var(--primary))]',
    success: 'bg-[hsl(var(--success))]',
  };

  // Estimated revenue
  const avgJobValue = 12500;
  const estimatedRevenue = (overview?.leads.won || 0) * avgJobValue;
  const pipelineValue = Math.round(totalLeads * 0.2) * avgJobValue;

  return (
    <div className="mx-auto max-w-6xl bg-[hsl(var(--background))] p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Analytics</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Track your performance and ROI
        </p>
      </div>

      {/* KPI Cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Total Leads"
          value={overview?.leads.total || 0}
          icon={Users}
          tone="info"
        />
        <StatCard
          label="New Leads"
          value={overview?.leads.new || 0}
          icon={UserPlus}
          tone="success"
        />
        <StatCard
          label="Won"
          value={overview?.leads.won || 0}
          icon={Trophy}
          tone="warning"
        />
        <StatCard
          label="Conversion Rate"
          value={`${overview?.leads.conversionRate || 0}%`}
          icon={TrendingUp}
          tone="accent"
        />
        <StatCard
          label="Properties Tracked"
          value={overview?.properties.total || 0}
          icon={Home}
          tone="default"
        />
        <StatCard
          label="Storms (30 days)"
          value={overview?.storms.last30Days || 0}
          icon={CloudRain}
          tone="destructive"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Revenue Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Jobs Won</span>
              <span className="text-lg font-bold text-[hsl(var(--success))]">
                ${estimatedRevenue.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                Pipeline Value (Quoted)
              </span>
              <span className="text-lg font-bold text-[hsl(var(--primary))]">
                ${pipelineValue.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-[hsl(var(--border))] pt-3">
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Avg Job Value</span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                ${avgJobValue.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                Cost Per Lead (Eavesight)
              </span>
              <span className="text-sm font-bold text-[hsl(var(--success))]">$0</span>
            </div>
            <div className="mt-2 rounded-lg bg-[hsl(var(--success)/0.1)] p-3">
              <p className="text-xs text-[hsl(var(--success))]">
                Traditional lead cost: $50-200/lead. Eavesight generates leads from free public
                storm data — your cost per lead is effectively $0.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Conversion Funnel */}
        <Card>
          <CardHeader>
            <CardTitle>Lead Funnel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {funnelStages.map((stage) => {
              const widthPct =
                totalLeads > 0 ? Math.max((stage.count / totalLeads) * 100, 8) : 0;
              return (
                <div key={stage.label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-[hsl(var(--muted-foreground))]">{stage.label}</span>
                    <span className="font-semibold text-[hsl(var(--foreground))]">
                      {stage.count}
                    </span>
                  </div>
                  <div className="h-8 overflow-hidden rounded-lg bg-[hsl(var(--muted))]">
                    <div
                      className={cn(
                        'flex h-full items-center rounded-lg pl-2 transition-all duration-500',
                        toneBar[stage.tone]
                      )}
                      style={{ width: `${widthPct}%` }}
                    >
                      {widthPct > 15 && (
                        <span className="text-xs font-medium text-white">
                          {Math.round(widthPct)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Monthly Trends */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Leads by Month</CardTitle>
          </CardHeader>
          <CardContent>
            {monthly.length > 0 ? (
              <div className="flex h-48 items-end gap-2">
                {monthly.map((m) => (
                  <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                    <div className="text-xs font-semibold text-[hsl(var(--foreground))]">
                      {m.total}
                    </div>
                    <div
                      className="flex w-full flex-col gap-0.5"
                      style={{
                        height: `${(m.total / maxMonthly) * 100}%`,
                        minHeight: '4px',
                      }}
                    >
                      <div
                        className="min-h-[4px] flex-1 rounded-t bg-[hsl(var(--primary))]"
                        title={`Total: ${m.total}`}
                      />
                      {m.won > 0 && (
                        <div
                          className="rounded-b bg-[hsl(var(--success))]"
                          style={{
                            height: `${(m.won / m.total) * 100}%`,
                            minHeight: '4px',
                          }}
                          title={`Won: ${m.won}`}
                        />
                      )}
                    </div>
                    <div className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                      {m.month.split('-')[1]}/{m.month.split('-')[0].slice(2)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
                No monthly data yet
              </div>
            )}
            <div className="mt-3 flex gap-4 text-xs text-[hsl(var(--muted-foreground))]">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded bg-[hsl(var(--primary))]" />
                <span>Total Leads</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded bg-[hsl(var(--success))]" />
                <span>Won</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
