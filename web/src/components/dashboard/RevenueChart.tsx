'use client';

import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { getRevenueStats } from '@/lib/api';
import type { RevenueStats } from '@/lib/types';

type Period = 'day' | 'week' | 'month' | 'year';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Jour' },
  { key: 'week', label: 'Semaine' },
  { key: 'month', label: 'Mois' },
  { key: 'year', label: 'Année' },
];

// ── Tooltip ───────────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-semibold text-slate-400">{label}</p>
      <p className="font-bold text-white">{(payload[0]?.value ?? 0).toFixed(2)} MAD</p>
    </div>
  );
}

// ── Chart body — keyed on period so state auto-resets when period changes ─────

function ChartBody({ period }: { period: Period }) {
  const [stats, setStats] = useState<RevenueStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRevenueStats(period)
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [period]);

  const chartData =
    stats?.labels.map((label, i) => ({
      label,
      revenue: stats.revenue[i] ?? 0,
    })) ?? [];

  const hasData = chartData.some((d) => d.revenue > 0);

  return (
    <>
      {/* Summary row */}
      {stats && (
        <div className="mb-4 flex gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Revenu total</p>
            <p className="mt-0.5 text-xl font-bold text-white">
              {stats.totalRevenue.toFixed(2)}
              <span className="ml-1 text-sm font-semibold text-slate-400">MAD</span>
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Sessions</p>
            <p className="mt-0.5 text-xl font-bold text-white">{stats.totalSessions}</p>
          </div>
        </div>
      )}

      {/* Chart area */}
      <div className="h-44">
        {!stats && !error && (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
          </div>
        )}
        {error && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-slate-600">Impossible de charger les données</p>
          </div>
        )}
        {stats && !hasData && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-slate-600">Aucune donnée pour cette période</p>
          </div>
        )}
        {stats && hasData && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}

// ── Container — owns period selection, passes key to body ─────────────────────

export function RevenueChart() {
  const [period, setPeriod] = useState<Period>('week');

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-lg">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-white">Statistiques de revenu</h2>
        <div className="flex gap-1">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                period === key
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 hover:bg-slate-700 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* key={period} unmounts/remounts ChartBody on period change → state auto-resets */}
      <ChartBody key={period} period={period} />
    </div>
  );
}
