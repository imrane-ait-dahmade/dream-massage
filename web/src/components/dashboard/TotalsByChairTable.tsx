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
  if (loading && !data) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
        <div className="border-b border-slate-700 px-4 py-3">
          <div className="h-4 w-36 animate-pulse rounded bg-slate-700" />
        </div>
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-slate-700/40" />
          ))}
        </div>
      </div>
    );
  }

  const isEmpty = !data || data.every((r) => r.sessionsCount === 0);

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

      {/* Horizontal scroll only — no max-height capping */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-700/50">
              {[
                { h: 'Fauteuil',   align: 'text-left' },
                { h: 'Sessions',   align: 'text-right' },
                { h: 'Hors règle', align: 'text-right' },
                { h: 'Total DH',   align: 'text-right' },
                { h: 'Durée',      align: 'text-right' },
                { h: 'Plans',      align: 'text-right' },
              ].map(({ h, align }) => (
                <th
                  key={h}
                  className={`px-4 py-2.5 ${align} text-[10px] font-semibold uppercase tracking-wide text-slate-400 md:py-3 md:text-[11px]`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-700/40">
            {isEmpty ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-600 md:py-10">
                  Aucune session pour cette période
                </td>
              </tr>
            ) : (
              data!.map((row) => (
                <tr key={row.chairId} className="transition-colors hover:bg-slate-700/20">
                  <td className="px-4 py-2.5 text-sm font-semibold text-white md:py-3">
                    {row.displayName ?? row.chairName}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm text-slate-300 md:py-3">
                    {row.sessionsCount || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right md:py-3">
                    <span className={row.outOfRuleSessionsCount > 0 ? 'text-orange-400' : 'text-slate-600'}>
                      {row.outOfRuleSessionsCount || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-semibold text-white md:py-3">
                    {row.revenue > 0 ? formatDH(row.revenue) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-400 md:py-3">
                    {row.durationTotalSeconds > 0 ? formatDuration(row.durationTotalSeconds) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-500 md:py-3">
                    {row.plans.length > 0
                      ? row.plans.map((p) => `${p.label}×${p.count}`).join(', ')
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {!isEmpty && totals && (
            <tfoot>
              <tr className="border-t border-slate-700 bg-slate-700/30">
                <td className="px-4 py-2.5 text-sm font-bold text-slate-300 md:py-3">Total</td>
                <td className="px-4 py-2.5 text-right text-sm font-bold text-slate-300 md:py-3">{totals.sessionsCount}</td>
                <td className="px-4 py-2.5 text-right text-sm font-bold text-orange-400 md:py-3">{totals.outOfRuleSessionsCount || '—'}</td>
                <td className="px-4 py-2.5 text-right text-sm font-bold text-white md:py-3">{formatDH(totals.revenue)}</td>
                <td className="px-4 py-2.5 text-right text-xs text-slate-400 md:py-3">
                  {totals.durationTotalSeconds > 0 ? formatDuration(totals.durationTotalSeconds) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-600 md:py-3">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
