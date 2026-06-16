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

const PERIODS = [
  { value: 'all',     label: 'Toute la journée' },
  { value: 'matin',   label: 'Matin' },
  { value: 'soir',    label: 'Soir' },
  { value: 'journee', label: 'Journée' },
  { value: 'custom',  label: 'Perso' },
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

  const isCustom = filters.period === 'custom';
  const hasAdvancedActive = filters.staffMemberId !== 'all'
    || filters.shiftTypeId !== 'all'
    || filters.shiftId !== 'all'
    || filters.status !== 'all'
    || filters.period !== 'all';

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

      {/* ── Row 2: Dates + Chair + Fille (always visible) ─────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:flex md:flex-wrap">
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
        <Field label="Fauteuil" className="md:w-[100px]">
          <select
            value={filters.chair}
            onChange={(e) => set({ chair: e.target.value })}
            className={SELECT_CLS}
          >
            <option value="all" className="bg-slate-800">Tous</option>
            {filterOptions?.chairs.map((c) => (
              <option key={c.id} value={c.name} className="bg-slate-800">
                {c.displayName ?? c.name}
              </option>
            )) ?? ['F1','F2','F3','F4','F5'].map((n) => (
              <option key={n} value={n} className="bg-slate-800">{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Fille" className="md:w-[120px]">
          <select
            value={filters.staffMemberId}
            onChange={(e) => setParent({ staffMemberId: e.target.value })}
            className={SELECT_CLS}
            disabled={!filterOptions?.staffMembers.length}
          >
            <option value="all" className="bg-slate-800">Toutes</option>
            {filterOptions?.staffMembers.map((s) => (
              <option key={s.id} value={s.id} className="bg-slate-800">{s.name}</option>
            ))}
          </select>
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:flex-wrap md:gap-2">
          <Field label="Période">
            <select
              value={filters.period}
              onChange={(e) => setParent({ period: e.target.value as HomeDashboardFilters['period'] })}
              className={SELECT_CLS}
            >
              {PERIODS.map(({ value, label }) => (
                <option key={value} value={value} className="bg-slate-800">{label}</option>
              ))}
            </select>
          </Field>

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

          <Field label="Type shift" className="md:w-[120px]">
            <select
              value={filters.shiftTypeId}
              onChange={(e) => setParent({ shiftTypeId: e.target.value })}
              className={SELECT_CLS}
              disabled={!filterOptions?.shiftTypes.length}
            >
              <option value="all" className="bg-slate-800">Tous types</option>
              {filterOptions?.shiftTypes.map((st) => (
                <option key={st.id} value={st.id} className="bg-slate-800">{st.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Shift" className="col-span-2 sm:col-span-1 md:min-w-[160px]">
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

        {/* Custom time range */}
        {isCustom && (
          <div className="flex flex-wrap gap-2 border-t border-slate-700/60 pt-2">
            <Field label="Heure début" className="w-[calc(50%-4px)] md:w-[120px]">
              <input
                type="time"
                value={filters.periodStart ?? ''}
                onChange={(e) => set({ periodStart: e.target.value })}
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Heure fin" className="w-[calc(50%-4px)] md:w-[120px]">
              <input
                type="time"
                value={filters.periodEnd ?? ''}
                onChange={(e) => set({ periodEnd: e.target.value })}
                className={INPUT_CLS}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
