'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';

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
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stats = [
    {
      label: 'Total Leads',
      value: overview?.leads.total || 0,
      icon: '👥',
      color: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      label: 'New Leads',
      value: overview?.leads.new || 0,
      icon: '🆕',
      color: 'bg-green-50 text-green-700 border-green-200',
    },
    {
      label: 'Won',
      value: overview?.leads.won || 0,
      icon: '🏆',
      color: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    },
    {
      label: 'Conversion Rate',
      value: `${overview?.leads.conversionRate || 0}%`,
      icon: '📈',
      color: 'bg-purple-50 text-purple-700 border-purple-200',
    },
    {
      label: 'Properties Tracked',
      value: overview?.properties.total || 0,
      icon: '🏠',
      color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    },
    {
      label: 'Storms (30 days)',
      value: overview?.storms.last30Days || 0,
      icon: '⛈️',
      color: 'bg-orange-50 text-orange-700 border-orange-200',
    },
  ];

  // Simple bar chart using divs
  const maxMonthly = Math.max(...monthly.map(m => m.total), 1);

  // Conversion funnel (estimated from overview)
  const totalLeads = overview?.leads.total || 0;
  const funnelStages = [
    { label: 'Total Leads', count: totalLeads, color: 'bg-blue-500' },
    { label: 'Contacted', count: Math.round(totalLeads * 0.6), color: 'bg-purple-500' },
    { label: 'Qualified', count: Math.round(totalLeads * 0.35), color: 'bg-yellow-500' },
    { label: 'Quoted', count: Math.round(totalLeads * 0.2), color: 'bg-cyan-500' },
    { label: 'Won', count: overview?.leads.won || 0, color: 'bg-green-500' },
  ];

  // Estimated revenue
  const avgJobValue = 12500; // average insurance roof replacement
  const estimatedRevenue = (overview?.leads.won || 0) * avgJobValue;
  const pipelineValue = Math.round(totalLeads * 0.2) * avgJobValue; // quoted leads

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Track your performance and ROI</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className={`rounded-xl border p-4 ${stat.color}`}>
            <div className="text-2xl mb-1">{stat.icon}</div>
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-xs font-medium opacity-70">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Summary */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue Snapshot</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Jobs Won</span>
              <span className="text-lg font-bold text-green-600">
                ${estimatedRevenue.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Pipeline Value (Quoted)</span>
              <span className="text-lg font-bold text-blue-600">
                ${pipelineValue.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center border-t border-gray-100 pt-3">
              <span className="text-sm text-gray-600">Avg Job Value</span>
              <span className="text-sm font-medium text-gray-900">
                ${avgJobValue.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Cost Per Lead (Eavesight)</span>
              <span className="text-sm font-bold text-green-600">$0</span>
            </div>
            <div className="bg-green-50 rounded-lg p-3 mt-2">
              <p className="text-xs text-green-700">
                Traditional lead cost: $50-200/lead. Eavesight generates leads from free public storm data — your cost per lead is effectively $0.
              </p>
            </div>
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Lead Funnel</h2>
          <div className="space-y-3">
            {funnelStages.map((stage, i) => {
              const widthPct = totalLeads > 0 ? Math.max((stage.count / totalLeads) * 100, 8) : 0;
              return (
                <div key={stage.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">{stage.label}</span>
                    <span className="font-semibold">{stage.count}</span>
                  </div>
                  <div className="h-8 bg-gray-100 rounded-lg overflow-hidden">
                    <div
                      className={`h-full ${stage.color} rounded-lg transition-all duration-500 flex items-center pl-2`}
                      style={{ width: `${widthPct}%` }}
                    >
                      {widthPct > 15 && (
                        <span className="text-white text-xs font-medium">{Math.round(widthPct)}%</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly Trends */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Leads by Month</h2>
          {monthly.length > 0 ? (
            <div className="flex items-end gap-2 h-48">
              {monthly.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-xs font-semibold text-gray-700">{m.total}</div>
                  <div className="w-full flex flex-col gap-0.5" style={{ height: `${(m.total / maxMonthly) * 100}%`, minHeight: '4px' }}>
                    <div
                      className="bg-blue-500 rounded-t flex-1 min-h-[4px]"
                      title={`Total: ${m.total}`}
                    />
                    {m.won > 0 && (
                      <div
                        className="bg-green-500 rounded-b"
                        style={{ height: `${(m.won / m.total) * 100}%`, minHeight: '4px' }}
                        title={`Won: ${m.won}`}
                      />
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500 font-medium">
                    {m.month.split('-')[1]}/{m.month.split('-')[0].slice(2)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              No monthly data yet
            </div>
          )}
          <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-blue-500 rounded" />
              <span>Total Leads</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-green-500 rounded" />
              <span>Won</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
