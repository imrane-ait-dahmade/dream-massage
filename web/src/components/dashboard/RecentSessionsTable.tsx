'use client';

import { useState, useMemo } from 'react';
import { Pencil, Search, X } from 'lucide-react';
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

const INFORMATIONAL_ANOMALIES = new Set(['TOO_LONG', 'LONG', 'DURATION_EXCEEDED']);

const BILLING_BADGE: Record<string, { label: string; cls: string }> = {
  CALCULATED: { label: 'AUTO',       cls: 'bg-slate-600/40 text-slate-400' },
  CORRECTED:  { label: 'CORRIGÉ',    cls: 'bg-blue-500/20 text-blue-300' },
  PENDING:    { label: 'EN ATTENTE', cls: 'bg-amber-500/20 text-amber-400' },
  DISPUTED:   { label: 'LITIGE',     cls: 'bg-red-500/20 text-red-400' },
};

// ── Time helpers ───────────────────────────────────────────────────────────────
// Always convert to Africa/Casablanca so filtering works regardless of browser timezone.

function sessionLocalMinutes(isoString: string): number {
  try {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Casablanca',
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false,
    }).formatToParts(new Date(isoString));
    const h = Number(parts.find((p) => p.type === 'hour')?.value   ?? '0');
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h * 60 + m;
  } catch {
    return -1;
  }
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

// ── Internal filter types ─────────────────────────────────────────────────────

type StatusFilter = 'all' | 'completed' | 'active' | 'corrected' | 'outofRule' | 'long';

const QUICK_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'all',       label: 'Toutes'     },
  { key: 'corrected', label: 'Corrigées'  },
  { key: 'outofRule', label: 'Hors règle' },
  { key: 'long',      label: 'Longues'    },
];

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
    const parts      = anomalyType.split(',').map((a) => a.trim());
    const label      = ANOMALY_LABEL[parts[0] ?? ''] ?? parts[0] ?? 'Anomalie';
    const isBilled   = billingStatus === 'CALCULATED' || billingStatus === 'CORRECTED';
    const isInfoOnly = parts.every((a) => INFORMATIONAL_ANOMALIES.has(a));

    if (isInfoOnly && isBilled) {
      return (
        <span className="inline-flex rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
          {label}
        </span>
      );
    }
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

  // Internal table search — client-side only, no API calls, no effect on dashboard totals
  const [query,        setQuery]        = useState('');
  const [startTime,    setStartTime]    = useState('');
  const [endTime,      setEndTime]      = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const hasActiveFilters =
    query !== '' || startTime !== '' || endTime !== '' || statusFilter !== 'all';

  function clearFilters() {
    setQuery('');
    setStartTime('');
    setEndTime('');
    setStatusFilter('all');
  }

  // When main filters change (parent refetches), reset internal search so stale
  // filter values don't hide the new dataset.
  // (handled naturally: visible is recomputed from the new `sessions` prop)

  const visible: HomeRecentSession[] = useMemo(() => {
    if (!sessions) return [];
    if (!hasActiveFilters) return sessions;

    const needle = query.trim().toLowerCase();

    return sessions.filter((s) => {
      // ── General text search ──────────────────────────────────────────────────
      if (needle) {
        const amount = s.finalAmount ?? s.amount ?? 0;
        const hit =
          s.chairName.toLowerCase().includes(needle) ||
          (s.staffMemberName?.toLowerCase().includes(needle) ?? false) ||
          (s.shiftTypeLabel?.toLowerCase().includes(needle) ?? false) ||
          (s.matchedPlanName?.toLowerCase().includes(needle) ?? false) ||
          String(Math.round(amount)).includes(needle) ||
          (s.anomalyType?.toLowerCase().includes(needle) ?? false) ||
          (STATUS_LABEL[s.status]?.toLowerCase().includes(needle) ?? false);
        if (!hit) return false;
      }

      // ── Time window ──────────────────────────────────────────────────────────
      if (startTime) {
        const sessionMin  = sessionLocalMinutes(s.startedAt);
        const filterStart = hhmmToMinutes(startTime);
        if (endTime) {
          // Explicit range [startTime, endTime] inclusive
          if (sessionMin < filterStart || sessionMin > hhmmToMinutes(endTime)) return false;
        } else {
          // No end time → 5-minute tolerance window [startTime, startTime+5)
          if (sessionMin < filterStart || sessionMin >= filterStart + 5) return false;
        }
      }

      // ── Status / category ────────────────────────────────────────────────────
      if (statusFilter === 'completed' && s.status !== 'COMPLETED') return false;
      if (statusFilter === 'active'    && s.status !== 'ACTIVE')    return false;
      if (statusFilter === 'corrected' &&
          s.correctedAmount == null && s.billingStatus !== 'CORRECTED') return false;
      if (statusFilter === 'outofRule' && !s.isOutOfRule) return false;
      if (statusFilter === 'long') {
        const parts = s.anomalyType?.split(',').map((a) => a.trim()) ?? [];
        if (!parts.some((a) => INFORMATIONAL_ANOMALIES.has(a))) return false;
      }

      return true;
    });
  }, [sessions, query, startTime, endTime, statusFilter, hasActiveFilters]);

  const countLabel = (() => {
    if (loading && !sessions) return 'Chargement…';
    if (!hasActiveFilters) return total !== undefined ? `${total} session${total !== 1 ? 's' : ''}` : '';
    return `${visible.length} / ${total ?? sessions?.length ?? 0} affichées`;
  })();

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="border-b border-slate-700 px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-white">Sessions de la période</h3>
            <span className="shrink-0 text-xs text-slate-500">{countLabel}</span>
          </div>
        </div>

        {/* ── Search / filter bar ──────────────────────────────────────────── */}
        <div className="border-b border-slate-700/60 px-3 py-2.5 md:px-4">
          {/* Row 1: inputs */}
          <div className="flex flex-wrap items-center gap-2">
            {/* General search */}
            <div className="relative min-w-[140px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Fauteuil, fille, prix, plan…"
                className="w-full rounded-lg border border-slate-600 bg-slate-700/40 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-blue-500/50 focus:outline-none"
              />
            </div>

            {/* Heure début */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 hidden sm:inline">Début</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                title="Heure début"
                className="rounded-lg border border-slate-600 bg-slate-700/40 px-2 py-1.5 text-xs text-white focus:border-blue-500/50 focus:outline-none [color-scheme:dark]"
              />
            </div>

            {/* Heure fin */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 hidden sm:inline">Fin</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                title="Heure fin"
                className="rounded-lg border border-slate-600 bg-slate-700/40 px-2 py-1.5 text-xs text-white focus:border-blue-500/50 focus:outline-none [color-scheme:dark]"
              />
            </div>

            {/* Status select */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-slate-600 bg-slate-700/40 px-2 py-1.5 text-xs text-white focus:border-blue-500/50 focus:outline-none"
            >
              <option value="all">Statut — Tous</option>
              <option value="completed">Terminé</option>
              <option value="active">En cours</option>
              <option value="corrected">Corrigé</option>
              <option value="outofRule">Hors règle</option>
              <option value="long">Long</option>
            </select>

            {/* Clear button */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 rounded-lg border border-slate-600 px-2.5 py-1.5 text-[10px] font-medium text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors"
              >
                <X className="h-3 w-3" />
                Effacer
              </button>
            )}
          </div>

          {/* Row 2: quick chips */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_CHIPS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key === statusFilter ? 'all' : key)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  statusFilter === key
                    ? 'border-blue-500/50 bg-blue-500/20 text-blue-300'
                    : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────────────────────── */}
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

              {/* Empty — no sessions at all for this period */}
              {!loading && sessions && sessions.length === 0 && (
                <tr>
                  <td colSpan={COLS.length} className="px-4 py-10 text-center">
                    <p className="text-sm text-slate-600">Aucune session pour cette période</p>
                  </td>
                </tr>
              )}

              {/* Empty — sessions exist but none match the internal filters */}
              {!loading && sessions && sessions.length > 0 && visible.length === 0 && (
                <tr>
                  <td colSpan={COLS.length} className="px-4 py-10 text-center">
                    <p className="text-sm text-slate-500">Aucune session ne correspond à cette recherche.</p>
                    <button
                      onClick={clearFilters}
                      className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
                    >
                      Effacer les filtres
                    </button>
                  </td>
                </tr>
              )}

              {/* Data rows */}
              {visible.map((s) => (
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

      {/* Correction modal — unchanged */}
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
