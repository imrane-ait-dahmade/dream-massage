'use client';

import { useState } from 'react';
import { RotateCcw, FileDown, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import type { HomeDashboardFilters, DashboardFilterOptions } from '@/lib/types';

// ── Client-side preset date computation ───────────────────────────────────────

function localDateStr(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

function presetDates(preset: string): { from: string; to: string } {
  const now   = new Date();
  const today = localDateStr(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1);
      const y = localDateStr(d);
      return { from: y, to: y };
    }
    case 'week': {
      const d   = new Date(now);
      const dow = d.getDay();
      d.setDate(d.getDate() - ((dow + 6) % 7));
      const mon = localDateStr(d);
      const sun = new Date(d); sun.setDate(d.getDate() + 6);
      return { from: mon, to: localDateStr(sun) };
    }
    case 'month': {
      const y  = now.getFullYear();
      const mo = now.getMonth() + 1;
      const mm = String(mo).padStart(2, '0');
      const last = new Date(y, mo, 0).getDate();
      return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
    }
    case 'year': {
      const y = now.getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      return { from: today, to: today };
  }
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PRESETS = [
  { key: 'today',     label: "Auj." },
  { key: 'yesterday', label: 'Hier' },
  { key: 'week',      label: 'Semaine' },
  { key: 'month',     label: 'Mois' },
  { key: 'year',      label: 'Année' },
] as const;

const STATUSES = [
  { value: 'all',       label: 'Tous statuts' },
  { value: 'ACTIVE',    label: 'En cours' },
  { value: 'COMPLETED', label: 'Terminées' },
  { value: 'PENDING',   label: 'En attente' },
  { value: 'CORRECTED', label: 'Corrigées' },
  { value: 'ANOMALY',   label: 'Hors règle' },
] as const;

const CHART_PERIODS: { key: HomeDashboardFilters['chartPeriod']; label: string }[] = [
  { key: 'day',   label: 'Jour' },
  { key: 'week',  label: 'Semaine' },
  { key: 'month', label: 'Mois' },
  { key: 'year',  label: 'Année' },
];

// ── Style constants ────────────────────────────────────────────────────────────

const INPUT_CLS =
  'rounded-lg border border-slate-600 bg-slate-700/60 px-2.5 py-1.5 text-xs text-white [color-scheme:dark] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 w-full';
const SELECT_CLS =
  'rounded-lg border border-slate-600 bg-slate-700/60 px-2 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 cursor-pointer w-full';
const LABEL_CLS = 'text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1 block';

// ── Sub-component ──────────────────────────────────────────────────────────────

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <span className={LABEL_CLS}>{label}</span>
      {children}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  filters:       HomeDashboardFilters;
  filterOptions: DashboardFilterOptions | undefined;
  onChange:      (f: HomeDashboardFilters) => void;
  onReset:       () => void;
  loading:       boolean;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function DashboardFilters({ filters, filterOptions, onChange, onReset, loading }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const set = (partial: Partial<HomeDashboardFilters>) => onChange({ ...filters, ...partial });
  const setParent = (partial: Partial<HomeDashboardFilters>) =>
    onChange({ ...filters, ...partial, shiftId: 'all' });

  function applyPreset(key: string) {
    const { from, to } = presetDates(key);
    setParent({ preset: key, from, to });
  }

  // Hidden filters stay at defaults ('all') — logic unchanged.
  const hasAdvancedActive = filters.shiftId !== 'all' || filters.status !== 'all';

  return (
    <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-800/60 p-3 backdrop-blur-sm md:p-4">

      {/* ── Row 1: Preset pills ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => applyPreset(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              filters.preset === key
                ? 'bg-blue-600 text-white'
                : 'border border-slate-600 text-slate-400 hover:border-slate-500 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-500" />}
          <button
            onClick={onReset}
            className="flex items-center gap-1 rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:border-slate-500 hover:bg-slate-700 hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
            <span className="hidden sm:block">Reset</span>
          </button>
          <button
            disabled
            title="Export Excel bientôt disponible"
            className="flex cursor-not-allowed items-center gap-1 rounded-lg bg-blue-600/20 px-2.5 py-1.5 text-xs font-semibold text-blue-400/40"
          >
            <FileDown className="h-3 w-3" />
            <span className="hidden sm:block">Excel</span>
          </button>
        </div>
      </div>

      {/* ── Row 2: Dates only ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
        <Field label="Début" className="md:w-[130px]">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setParent({ from: e.target.value, preset: 'custom' })}
            className={INPUT_CLS}
          />
        </Field>
        <Field label="Fin" className="md:w-[130px]">
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setParent({ to: e.target.value, preset: 'custom' })}
            className={INPUT_CLS}
          />
        </Field>
      </div>

      {/* ── Advanced toggle (mobile) ───────────────────────────────────────── */}
      <button
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-700/40 md:hidden"
      >
        <span>
          Filtres avancés
          {hasAdvancedActive && (
            <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] text-white">actif</span>
          )}
        </span>
        {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {/* ── Advanced filters (mobile: collapsible, desktop: always visible) ── */}
      <div className={`space-y-2 ${advancedOpen ? 'block' : 'hidden'} md:block`}>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:gap-2">
          <Field label="Statut">
            <select
              value={filters.status}
              onChange={(e) => set({ status: e.target.value })}
              className={SELECT_CLS}
            >
              {STATUSES.map(({ value, label }) => (
                <option key={value} value={value} className="bg-slate-800">{label}</option>
              ))}
            </select>
          </Field>

          <Field label="Shift" className="md:min-w-[160px]">
            <select
              value={filters.shiftId}
              onChange={(e) => set({ shiftId: e.target.value })}
              className={SELECT_CLS}
              disabled={!filterOptions?.shifts.length}
            >
              <option value="all" className="bg-slate-800">Tous les shifts</option>
              {filterOptions?.shifts.map((sh) => (
                <option key={sh.id} value={sh.id} className="bg-slate-800">
                  {sh.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Chart period */}
        <div className="flex items-center gap-2">
          <span className={LABEL_CLS + ' mb-0'}>Graphique :</span>
          <div className="flex gap-1.5">
            {CHART_PERIODS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => set({ chartPeriod: key })}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  filters.chartPeriod === key
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-600 text-slate-500 hover:bg-slate-700 hover:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
