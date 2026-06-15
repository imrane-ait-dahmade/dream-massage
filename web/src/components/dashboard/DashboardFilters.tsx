'use client';

import { RotateCcw, FileDown, RefreshCw } from 'lucide-react';
import type { HomeDashboardFilters } from '@/lib/types';

// ── Constants ──────────────────────────────────────────────────────────────────

const PERIODS = [
  { value: 'all',     label: 'Toute la journée' },
  { value: 'matin',   label: 'Matin' },
  { value: 'soir',    label: 'Soir' },
  { value: 'journee', label: 'Journée' },
  { value: 'custom',  label: 'Personnalisé' },
] as const;

const CHAIRS = [
  { value: 'all', label: 'Tous' },
  { value: 'F1',  label: 'F1' },
  { value: 'F2',  label: 'F2' },
  { value: 'F3',  label: 'F3' },
  { value: 'F4',  label: 'F4' },
  { value: 'F5',  label: 'F5' },
];

const CHART_PERIODS: { key: HomeDashboardFilters['chartPeriod']; label: string }[] = [
  { key: 'day',   label: 'Jour' },
  { key: 'week',  label: 'Semaine' },
  { key: 'month', label: 'Mois' },
  { key: 'year',  label: 'Année' },
];

// ── Style constants ────────────────────────────────────────────────────────────

const INPUT_CLS =
  'rounded-xl border border-slate-600 bg-slate-700/60 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50';
const SELECT_CLS =
  'rounded-xl border border-slate-600 bg-slate-700/60 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 cursor-pointer';
const LABEL_CLS = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500';

// ── Sub-components ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-[130px] flex-col gap-1.5">
      <span className={LABEL_CLS}>{label}</span>
      {children}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  filters: HomeDashboardFilters;
  onChange: (f: HomeDashboardFilters) => void;
  onReset: () => void;
  loading: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function DashboardFilters({ filters, onChange, onReset, loading }: Props) {
  const set = (partial: Partial<HomeDashboardFilters>) =>
    onChange({ ...filters, ...partial });

  const isCustom = filters.period === 'custom';

  return (
    <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-800/60 p-4 backdrop-blur-sm">
      {/* ── Row 1: date range, period, chair, actions ──────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date début">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => set({ from: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Date fin">
          <input
            type="date"
            value={filters.to}
            onChange={(e) => set({ to: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Période">
          <select
            value={filters.period}
            onChange={(e) =>
              set({ period: e.target.value as HomeDashboardFilters['period'] })
            }
            className={SELECT_CLS}
          >
            {PERIODS.map(({ value, label }) => (
              <option key={value} value={value} className="bg-slate-800 text-white">
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Fauteuil">
          <select
            value={filters.chair}
            onChange={(e) => set({ chair: e.target.value })}
            className={SELECT_CLS}
          >
            {CHAIRS.map(({ value, label }) => (
              <option key={value} value={value} className="bg-slate-800 text-white">
                {label}
              </option>
            ))}
          </select>
        </Field>

        {/* Action buttons */}
        <div className="flex gap-2 self-end">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 rounded-xl border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-400 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </button>
          <button
            disabled
            title="Export Excel bientôt disponible"
            className="flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-blue-600/30 px-3 py-2 text-xs font-semibold text-blue-400/40"
          >
            <FileDown className="h-3.5 w-3.5" />
            Export Excel
          </button>
        </div>

        {/* Loading spinner */}
        {loading && (
          <div className="self-end pb-2">
            <RefreshCw className="h-4 w-4 animate-spin text-slate-500" />
          </div>
        )}
      </div>

      {/* ── Custom period time inputs ──────────────────────────────────────── */}
      {isCustom && (
        <div className="flex flex-wrap gap-3 border-t border-slate-700/60 pt-3">
          <Field label="Heure début">
            <input
              type="time"
              value={filters.periodStart ?? ''}
              onChange={(e) => set({ periodStart: e.target.value })}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Heure fin">
            <input
              type="time"
              value={filters.periodEnd ?? ''}
              onChange={(e) => set({ periodEnd: e.target.value })}
              className={INPUT_CLS}
            />
          </Field>
        </div>
      )}

      {/* ── Chart period tabs ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-700/60 pt-3">
        <span className={LABEL_CLS}>Graphique :</span>
        <div className="flex gap-1">
          {CHART_PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => set({ chartPeriod: key })}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                filters.chartPeriod === key
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 hover:bg-slate-700 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
