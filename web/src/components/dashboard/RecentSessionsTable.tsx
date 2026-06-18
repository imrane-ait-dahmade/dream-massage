'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { HomeRecentSession } from '@/lib/types';
import { formatDH, formatElapsed, formatTime } from '@/lib/format';
import { SessionCorrectionModal } from './SessionCorrectionModal';

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
  TOO_SHORT:              'Court',
  TOO_LONG:               'Long',
  DURATION_EXCEEDED:      'Long',
  OUT_OF_HOURS:           'Hors h.',
  NO_PLAN_MATCH:          'Sans plan',
  NO_OPEN_SHIFT:          'Sans shift',
  OFFLINE_DURING_SESSION: 'Hors ligne',
  DEVICE_ERROR:           'Erreur',
};

// TOO_LONG and its aliases are informational duration badges — not billing problems.
const INFORMATIONAL_ANOMALIES = new Set(['TOO_LONG', 'LONG', 'DURATION_EXCEEDED']);

const BILLING_BADGE: Record<string, { label: string; cls: string }> = {
  CALCULATED: { label: 'AUTO',       cls: 'bg-slate-600/40 text-slate-400' },
  CORRECTED:  { label: 'CORRIGÉ',    cls: 'bg-blue-500/20 text-blue-300' },
  PENDING:    { label: 'EN ATTENTE', cls: 'bg-amber-500/20 text-amber-400' },
  DISPUTED:   { label: 'LITIGE',     cls: 'bg-red-500/20 text-red-400' },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[status] ?? 'bg-slate-600/40 text-slate-400'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function BillingBadge({ billingStatus, anomalyType }: { billingStatus: string; anomalyType: string | null }) {
  if (anomalyType) {
    const parts     = anomalyType.split(',').map((a) => a.trim());
    const label     = ANOMALY_LABEL[parts[0] ?? ''] ?? parts[0] ?? 'Anomalie';
    const isBilled  = billingStatus === 'CALCULATED' || billingStatus === 'CORRECTED';
    const isInfoOnly = parts.every((a) => INFORMATIONAL_ANOMALIES.has(a));

    if (isInfoOnly && isBilled) {
      // Duration badge — informational, session is correctly billed.
      return (
        <span className="inline-flex rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
          {label}
        </span>
      );
    }
    // Real billing anomaly — warning color.
    return (
      <span className="inline-flex rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-semibold text-orange-400">
        {label}
      </span>
    );
  }
  const b = BILLING_BADGE[billingStatus];
  if (!b) return null;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
      {b.label}
    </span>
  );
}

// ── Column headers ─────────────────────────────────────────────────────────────

const COLS = ['Fauteuil', 'Fille', 'Shift', 'Début', 'Fin', 'Durée', 'Plan', 'Prix', 'Statut', ''];

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  sessions:   HomeRecentSession[] | undefined;
  total:      number | undefined;
  loading:    boolean;
  onCorrect?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecentSessionsTable({ sessions, total, loading, onCorrect }: Props) {
  const [correcting, setCorrecting] = useState<HomeRecentSession | null>(null);

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
        <div className="border-b border-slate-700 px-4 py-3">
          <h3 className="text-sm font-bold text-white">Sessions de la période</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {total !== undefined
              ? `${total} session${total !== 1 ? 's' : ''}`
              : 'Chargement…'}
          </p>
        </div>

        {/* Horizontal scroll — allow full vertical expansion (no max-height cap) */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-700/30">
                {COLS.map((c) => (
                  <th key={c} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-700/40">
              {/* Skeleton rows during initial load */}
              {loading && !sessions && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: COLS.length }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <div className="h-2.5 w-14 animate-pulse rounded bg-slate-700" />
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
                  <td className="px-3 py-2.5 text-sm font-semibold text-white">{s.chairName}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">
                    {s.staffMemberName ?? <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">
                    {s.shiftTypeLabel ?? <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-400 tabular-nums">{formatTime(s.startedAt)}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-400 tabular-nums">{formatTime(s.endedAt)}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-400 tabular-nums">
                    {s.durationSeconds !== null ? formatElapsed(s.durationSeconds) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">
                    {s.matchedPlanName ?? <span className="text-slate-600">—</span>}
                  </td>
                  {/* Prix: show finalAmount + billing/anomaly badge */}
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-white">
                        {(s.finalAmount ?? s.amount) > 0 ? formatDH(s.finalAmount ?? s.amount) : '—'}
                      </span>
                      <BillingBadge billingStatus={s.billingStatus} anomalyType={s.anomalyType} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={s.status} />
                  </td>
                  {/* Correction action */}
                  <td className="px-2 py-2.5">
                    {s.status !== 'ACTIVE' && (
                      <button
                        onClick={() => setCorrecting(s)}
                        title="Corriger le prix"
                        className="flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-300"
                      >
                        <Pencil className="h-3 w-3" />
                        <span className="hidden sm:block">Corriger</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Correction modal */}
      {correcting && (
        <SessionCorrectionModal
          session={correcting}
          onClose={() => setCorrecting(null)}
          onSuccess={() => {
            setCorrecting(null);
            onCorrect?.();
          }}
        />
      )}
    </>
  );
}
