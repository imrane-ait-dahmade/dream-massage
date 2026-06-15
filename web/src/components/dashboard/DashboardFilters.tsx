'use client';

import { useState } from 'react';
import { RotateCcw, FileDown } from 'lucide-react';

// TODO: connect filter state to /api/reports/sessions when report endpoints are ready.
// Currently all filters are UI-only and do not send requests to the backend.

const PERIODS = [
  { value: 'all', label: 'Toute la journée' },
  { value: '8h17', label: '8h – 17h' },
  { value: 'morning', label: 'Matin' },
  { value: 'afternoon', label: 'Après-midi' },
];

const CHAIRS = [
  { value: 'all', label: 'Tous' },
  { value: 'F1', label: 'F1' },
  { value: 'F2', label: 'F2' },
  { value: 'F3', label: 'F3' },
  { value: 'F4', label: 'F4' },
  { value: 'F5', label: 'F5' },
];

interface FilterState {
  dateFrom: string;
  dateTo: string;
  period: string;
  chair: string;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const INPUT_CLS =
  'rounded-xl border border-slate-600 bg-slate-700/60 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50';

const SELECT_CLS =
  'rounded-xl border border-slate-600 bg-slate-700/60 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 cursor-pointer';

const LABEL_CLS = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500';

export function DashboardFilters() {
  const [filters, setFilters] = useState<FilterState>({
    dateFrom: todayISO(),
    dateTo: todayISO(),
    period: 'all',
    chair: 'all',
  });

  function reset() {
    setFilters({ dateFrom: todayISO(), dateTo: todayISO(), period: 'all', chair: 'all' });
  }

  function handleExport() {
    // TODO: implement Excel export once /api/reports/export endpoint is ready
    console.info('[TODO] Export Excel — backend endpoint not yet implemented');
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date début">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Date fin">
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Période">
          <select
            value={filters.period}
            onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))}
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
            onChange={(e) => setFilters((f) => ({ ...f, chair: e.target.value }))}
            className={SELECT_CLS}
          >
            {CHAIRS.map(({ value, label }) => (
              <option key={value} value={value} className="bg-slate-800 text-white">
                {label}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex gap-2 self-end">
          <button
            onClick={reset}
            className="flex items-center gap-1.5 rounded-xl border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-400 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </button>
          <button
            onClick={handleExport}
            title="Disponible après activation des rapports"
            className="flex items-center gap-1.5 rounded-xl bg-blue-600/80 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-600"
          >
            <FileDown className="h-3.5 w-3.5" />
            Export Excel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-[130px] flex-col gap-1.5">
      <span className={LABEL_CLS}>{label}</span>
      {children}
    </div>
  );
}
