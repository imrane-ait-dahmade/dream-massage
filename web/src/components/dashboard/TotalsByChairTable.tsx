'use client';

import type { HomeTotalsByChair } from '@/lib/types';
import { formatDH, formatDuration } from '@/lib/format';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  data: HomeTotalsByChair[] | undefined;
  loading: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TotalsByChairTable({ data, loading }: Props) {
  // Show skeleton only on initial load (no data yet)
  if (loading && !data) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
        <div className="border-b border-slate-700 px-4 py-3">
          <div className="h-4 w-36 animate-pulse rounded bg-slate-700" />
        </div>
        <div className="divide-y divide-slate-700/40 p-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-slate-700/40" />
          ))}
        </div>
      </div>
    );
  }

  const isEmpty = !data || data.every((r) => r.sessionsCount === 0);

  // Totals row aggregation
  const totals = data?.reduce(
    (acc, row) => ({
      sessionsCount:          acc.sessionsCount + row.sessionsCount,
      activeSessionsCount:    acc.activeSessionsCount + row.activeSessionsCount,
      outOfRuleSessionsCount: acc.outOfRuleSessionsCount + row.outOfRuleSessionsCount,
      revenue:                acc.revenue + row.revenue,
      durationTotalSeconds:   acc.durationTotalSeconds + row.durationTotalSeconds,
    }),
    { sessionsCount: 0, activeSessionsCount: 0, outOfRuleSessionsCount: 0, revenue: 0, durationTotalSeconds: 0 },
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
      <div className="border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-bold text-white">Totaux par fauteuil</h3>
        <p className="mt-0.5 text-xs text-slate-500">Pour la période et le filtre sélectionnés</p>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-700/50">
              {[
                { h: 'Fauteuil',  align: 'text-left' },
                { h: 'Sessions',  align: 'text-right' },
                { h: 'Actives',   align: 'text-right' },
                { h: 'Hors règle', align: 'text-right' },
                { h: 'Total DH',  align: 'text-right' },
                { h: 'Durée',     align: 'text-right' },
                { h: 'Plans',     align: 'text-right' },
              ].map(({ h, align }) => (
                <th
                  key={h}
                  className={`px-4 py-3 ${align} text-[11px] font-semibold uppercase tracking-wide text-slate-400`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-700/40">
            {isEmpty ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-600">
                  Aucune session pour cette période
                </td>
              </tr>
            ) : (
              data!.map((row) => (
                <tr key={row.chairId} className="transition-colors hover:bg-slate-700/20">
                  <td className="px-4 py-3 font-semibold text-white">
                    {row.displayName ?? row.chairName}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">
                    {row.sessionsCount || '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        row.activeSessionsCount > 0 ? 'text-emerald-400' : 'text-slate-600'
                      }
                    >
                      {row.activeSessionsCount || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        row.outOfRuleSessionsCount > 0 ? 'text-orange-400' : 'text-slate-600'
                      }
                    >
                      {row.outOfRuleSessionsCount || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-white">
                    {row.revenue > 0 ? formatDH(row.revenue) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">
                    {row.durationTotalSeconds > 0
                      ? formatDuration(row.durationTotalSeconds)
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">
                    {row.plans.length > 0
                      ? row.plans.map((p) => `${p.label}×${p.count}`).join(', ')
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {/* Totals footer — only when there is data */}
          {!isEmpty && totals && (
            <tfoot>
              <tr className="border-t border-slate-700 bg-slate-700/30">
                <td className="px-4 py-3 font-bold text-slate-300">Total</td>
                <td className="px-4 py-3 text-right font-bold text-slate-300">
                  {totals.sessionsCount}
                </td>
                <td className="px-4 py-3 text-right font-bold text-emerald-400">
                  {totals.activeSessionsCount || '—'}
                </td>
                <td className="px-4 py-3 text-right font-bold text-orange-400">
                  {totals.outOfRuleSessionsCount || '—'}
                </td>
                <td className="px-4 py-3 text-right font-bold text-white">
                  {formatDH(totals.revenue)}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-400">
                  {totals.durationTotalSeconds > 0
                    ? formatDuration(totals.durationTotalSeconds)
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
