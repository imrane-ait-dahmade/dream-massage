'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { HomeRevenueChart } from '@/lib/types';

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

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  data: HomeRevenueChart | undefined;
  loading: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RevenueChart({ data, loading }: Props) {
  const chartData =
    data?.labels.map((label, i) => ({
      label,
      revenue: data.revenue[i] ?? 0,
    })) ?? [];

  const hasData = chartData.some((d) => d.revenue > 0);

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-2 shadow-lg md:p-5">
      {/* Header */}
      <div className="mb-1.5 flex flex-wrap items-start justify-between gap-1 md:mb-4 md:gap-3">
        <h2 className="text-xs font-bold text-white md:text-sm">Revenus</h2>
        {data && (
          <div className="hidden gap-6 md:flex">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Revenu total</p>
              <p className="mt-0.5 text-lg font-bold text-white">
                {data.totalRevenue.toFixed(2)}
                <span className="ml-1 text-xs font-semibold text-slate-400">MAD</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Sessions</p>
              <p className="mt-0.5 text-lg font-bold text-white">{data.totalSessions}</p>
            </div>
          </div>
        )}
        {/* Mobile-only compact numbers */}
        {data && (
          <div className="flex gap-3 md:hidden">
            <span className="text-[10px] font-bold text-white">{data.totalRevenue.toFixed(0)} <span className="font-normal text-slate-500">DH</span></span>
            <span className="text-[10px] text-slate-500">{data.totalSessions} sess.</span>
          </div>
        )}
      </div>

      {/* Chart area */}
      <div className="h-[200px] md:h-52">
        {loading && !data && (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
          </div>
        )}
        {!loading && !hasData && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-slate-600">Aucune donnée pour cette période</p>
          </div>
        )}
        {hasData && (
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
    </div>
  );
}
