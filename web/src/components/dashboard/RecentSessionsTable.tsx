'use client';

import type { HomeRecentSession } from '@/lib/types';
import { formatDH, formatElapsed, formatTime } from '@/lib/format';

// ── Label maps ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  ACTIVE:    'En cours',
  COMPLETED: 'Terminée',
  UNCERTAIN: 'Incertaine',
  CANCELLED: 'Annulée',
  ERROR:     'Erreur',
};

const STATUS_CLASS: Record<string, string> = {
  ACTIVE:    'bg-emerald-500/20 text-emerald-400',
  COMPLETED: 'bg-blue-500/20 text-blue-300',
  UNCERTAIN: 'bg-orange-500/20 text-orange-400',
  CANCELLED: 'bg-slate-600/40 text-slate-500',
  ERROR:     'bg-red-500/20 text-red-400',
};

const ANOMALY_LABEL: Record<string, string> = {
  TOO_SHORT:     'Trop court',
  TOO_LONG:      'Trop long',
  OUT_OF_HOURS:  'Hors horaires',
  NO_PLAN_MATCH: 'Aucun plan',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        STATUS_CLASS[status] ?? 'bg-slate-600/40 text-slate-400'
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const COLS = ['Fauteuil', 'Début', 'Fin', 'Durée', 'Plan', 'Prix', 'Statut', 'Anomalie'];

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  sessions: HomeRecentSession[] | undefined;
  loading: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecentSessionsTable({ sessions, loading }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
      <div className="border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-bold text-white">Sessions récentes</h3>
        <p className="mt-0.5 text-xs text-slate-500">Tous fauteuils — 20 dernières de la période</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-700/30">
              {COLS.map((c) => (
                <th
                  key={c}
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-700/40">
            {/* Skeleton rows during initial load */}
            {loading && !sessions &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: COLS.length }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 w-16 animate-pulse rounded bg-slate-700" />
                    </td>
                  ))}
                </tr>
              ))}

            {/* Empty state */}
            {!loading && (!sessions || sessions.length === 0) && (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-10 text-center">
                  <p className="text-sm text-slate-600">Aucune session pour cette période</p>
                </td>
              </tr>
            )}

            {/* Data rows */}
            {sessions?.map((s) => (
              <tr key={s.id} className="transition-colors hover:bg-slate-700/20">
                <td className="px-4 py-3 font-semibold text-white">{s.chairName}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{formatTime(s.startedAt)}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{formatTime(s.endedAt)}</td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {s.durationSeconds !== null ? formatElapsed(s.durationSeconds) : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {s.matchedPlanName ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs font-semibold text-white">
                  {s.amount > 0 ? formatDH(s.amount) : '—'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-4 py-3 text-xs text-orange-400">
                  {s.anomalyType
                    ? (ANOMALY_LABEL[s.anomalyType] ?? s.anomalyType)
                    : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
