'use client';

import {
  Banknote,
  TrendingDown,
  DollarSign,
  BarChart3,
  Activity,
  AlertTriangle,
  Armchair,
  WifiOff,
} from 'lucide-react';
import type { HomeSummary } from '@/lib/types';
import { formatDH } from '@/lib/format';

// ── Single stat card ───────────────────────────────────────────────────────────

type Accent = 'emerald' | 'teal' | 'amber' | 'blue' | 'violet' | 'orange' | 'indigo' | 'red' | 'none';

const ACCENT_BORDER: Record<Accent, string> = {
  emerald: 'border-t-emerald-500/50',
  teal:    'border-t-teal-500/50',
  amber:   'border-t-amber-500/50',
  blue:    'border-t-blue-500/50',
  violet:  'border-t-violet-500/50',
  orange:  'border-t-orange-500/50',
  indigo:  'border-t-indigo-500/50',
  red:     'border-t-red-500/50',
  none:    'border-t-slate-700',
};

function StatCard({
  icon,
  iconClass,
  label,
  value,
  muted = false,
  accent,
}: {
  icon:      React.ReactNode;
  iconClass: string;
  label:     string;
  value:     string;
  muted?:    boolean;
  accent:    Accent;
}) {
  return (
    <div className={`rounded-2xl border border-slate-700 border-t-2 bg-slate-800 px-3 py-3 shadow-lg ${ACCENT_BORDER[accent]}`}>
      <div className={`mb-2 inline-flex rounded-xl p-1.5 ${iconClass}`}>{icon}</div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">{label}</p>
      <p className={`mt-1 text-xl font-bold leading-none ${muted ? 'text-slate-600' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-slate-700 border-t-2 border-t-slate-700 bg-slate-800 px-3 py-3 shadow-lg">
      <div className="mb-2 h-8 w-8 animate-pulse rounded-xl bg-slate-700" />
      <div className="h-2.5 w-16 animate-pulse rounded bg-slate-700" />
      <div className="mt-2 h-6 w-20 animate-pulse rounded bg-slate-700" />
    </div>
  );
}

// ── Grid ───────────────────────────────────────────────────────────────────────

interface Props {
  summary: HomeSummary | undefined;
  loading: boolean;
}

export function DashboardSummaryCards({ summary, loading }: Props) {
  if (loading && !summary) {
    return (
      <div className="grid grid-cols-4 gap-2 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }
  if (!summary) return null;

  return (
    <div className="grid grid-cols-4 gap-2 xl:grid-cols-8">
      {/* 1 – Revenu brut */}
      <StatCard
        icon={<Banknote className="h-4 w-4" />}
        iconClass="bg-emerald-500/20 text-emerald-400"
        label="Revenu brut"
        value={formatDH(summary.grossRevenue)}
        accent="emerald"
      />
      {/* 2 – Recette nette */}
      <StatCard
        icon={<TrendingDown className="h-4 w-4" />}
        iconClass="bg-teal-500/20 text-teal-400"
        label="Recette nette"
        value={formatDH(summary.netRevenue)}
        accent="teal"
      />
      {/* 3 – Prime totale */}
      <StatCard
        icon={<DollarSign className="h-4 w-4" />}
        iconClass={summary.totalPrime > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-600/40 text-slate-500'}
        label="Prime totale"
        value={formatDH(summary.totalPrime)}
        muted={summary.totalPrime === 0}
        accent={summary.totalPrime > 0 ? 'amber' : 'none'}
      />
      {/* 4 – Sessions */}
      <StatCard
        icon={<BarChart3 className="h-4 w-4" />}
        iconClass="bg-blue-500/20 text-blue-400"
        label="Sessions"
        value={String(summary.sessionsCount)}
        accent="blue"
      />
      {/* 5 – En cours */}
      <StatCard
        icon={<Activity className="h-4 w-4" />}
        iconClass={summary.activeSessionsCount > 0 ? 'bg-violet-500/20 text-violet-400' : 'bg-slate-600/40 text-slate-500'}
        label="En cours"
        value={String(summary.activeSessionsCount)}
        muted={summary.activeSessionsCount === 0}
        accent={summary.activeSessionsCount > 0 ? 'violet' : 'none'}
      />
      {/* 6 – Hors règle */}
      <StatCard
        icon={<AlertTriangle className="h-4 w-4" />}
        iconClass={summary.outOfRuleSessionsCount > 0 ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-600/40 text-slate-500'}
        label="Hors règle"
        value={String(summary.outOfRuleSessionsCount)}
        muted={summary.outOfRuleSessionsCount === 0}
        accent={summary.outOfRuleSessionsCount > 0 ? 'orange' : 'none'}
      />
      {/* 7 – Fauteuils actifs */}
      <StatCard
        icon={<Armchair className="h-4 w-4" />}
        iconClass={summary.activeChairs > 0 ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-600/40 text-slate-500'}
        label="Faut. actifs"
        value={String(summary.activeChairs)}
        muted={summary.activeChairs === 0}
        accent={summary.activeChairs > 0 ? 'indigo' : 'none'}
      />
      {/* 8 – Hors ligne */}
      <StatCard
        icon={<WifiOff className="h-4 w-4" />}
        iconClass={summary.offlineChairs > 0 ? 'bg-red-500/20 text-red-400' : 'bg-slate-600/40 text-slate-500'}
        label="Hors ligne"
        value={String(summary.offlineChairs)}
        muted={summary.offlineChairs === 0}
        accent={summary.offlineChairs > 0 ? 'red' : 'none'}
      />
    </div>
  );
}
