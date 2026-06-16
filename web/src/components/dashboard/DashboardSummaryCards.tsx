'use client';

import {
  Banknote,
  TrendingDown,
  DollarSign,
  BarChart3,
  Activity,
  AlertTriangle,
  WifiOff,
} from 'lucide-react';
import type { HomeSummary } from '@/lib/types';
import { formatDH } from '@/lib/format';

// ── Single stat card ───────────────────────────────────────────────────────────

type Accent = 'emerald' | 'teal' | 'amber' | 'blue' | 'violet' | 'orange' | 'red' | 'none';

const ACCENT_BORDER: Record<Accent, string> = {
  emerald: 'border-t-emerald-500/50',
  teal:    'border-t-teal-500/50',
  amber:   'border-t-amber-500/50',
  blue:    'border-t-blue-500/50',
  violet:  'border-t-violet-500/50',
  orange:  'border-t-orange-500/50',
  red:     'border-t-red-500/50',
  none:    'border-t-slate-700',
};

function StatCard({
  icon,
  iconClass,
  label,
  value,
  sub,
  muted = false,
  accent,
}: {
  icon:      React.ReactNode;
  iconClass: string;
  label:     string;
  value:     string;
  sub?:      string;
  muted?:    boolean;
  accent:    Accent;
}) {
  return (
    <div className={`rounded-2xl border border-slate-700 border-t-2 bg-slate-800 px-3 py-3 shadow-lg md:px-4 md:py-4 ${ACCENT_BORDER[accent]}`}>
      <div className={`mb-2 inline-flex rounded-xl p-1.5 ${iconClass}`}>
        {icon}
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 leading-tight md:text-[11px]">{label}</p>
      <p className={`mt-1 text-lg font-bold leading-none md:text-2xl ${muted ? 'text-slate-600' : 'text-white'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-600">{sub}</p>}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-slate-700 border-t-2 border-t-slate-700 bg-slate-800 px-3 py-3 shadow-lg md:px-4 md:py-4">
      <div className="mb-2 h-8 w-8 animate-pulse rounded-xl bg-slate-700" />
      <div className="h-2.5 w-14 animate-pulse rounded bg-slate-700 md:w-20" />
      <div className="mt-2 h-6 w-16 animate-pulse rounded bg-slate-700 md:h-7 md:w-24" />
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }
  if (!summary) return null;

  const iconSize = 'h-4 w-4';

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
      {/* 1 – Revenu brut */}
      <StatCard
        icon={<Banknote className={iconSize} />}
        iconClass="bg-emerald-500/20 text-emerald-400"
        label="Revenu brut"
        value={formatDH(summary.grossRevenue)}
        accent="emerald"
      />
      {/* 2 – Recette nette */}
      <StatCard
        icon={<TrendingDown className={iconSize} />}
        iconClass="bg-teal-500/20 text-teal-400"
        label="Recette nette"
        value={formatDH(summary.netRevenue)}
        accent="teal"
      />
      {/* 3 – Prime totale */}
      <StatCard
        icon={<DollarSign className={iconSize} />}
        iconClass={summary.totalPrime > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-600/40 text-slate-500'}
        label="Prime totale"
        value={formatDH(summary.totalPrime)}
        muted={summary.totalPrime === 0}
        accent={summary.totalPrime > 0 ? 'amber' : 'none'}
      />
      {/* 4 – Sessions */}
      <StatCard
        icon={<BarChart3 className={iconSize} />}
        iconClass="bg-blue-500/20 text-blue-400"
        label="Sessions"
        value={String(summary.sessionsCount)}
        sub={summary.activeSessionsCount > 0 ? `${summary.activeSessionsCount} en cours` : undefined}
        accent="blue"
      />
      {/* 5 – En cours */}
      <StatCard
        icon={<Activity className={iconSize} />}
        iconClass={summary.activeSessionsCount > 0 ? 'bg-violet-500/20 text-violet-400' : 'bg-slate-600/40 text-slate-500'}
        label="Fauteuils actifs"
        value={String(summary.activeChairs)}
        muted={summary.activeChairs === 0}
        accent={summary.activeChairs > 0 ? 'violet' : 'none'}
      />
      {/* 6 – Hors règle */}
      <StatCard
        icon={<AlertTriangle className={iconSize} />}
        iconClass={summary.outOfRuleSessionsCount > 0 ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-600/40 text-slate-500'}
        label="Hors règle"
        value={String(summary.outOfRuleSessionsCount)}
        muted={summary.outOfRuleSessionsCount === 0}
        accent={summary.outOfRuleSessionsCount > 0 ? 'orange' : 'none'}
      />
      {/* 7 – Hors ligne */}
      <StatCard
        icon={<WifiOff className={iconSize} />}
        iconClass={summary.offlineChairs > 0 ? 'bg-red-500/20 text-red-400' : 'bg-slate-600/40 text-slate-500'}
        label="Hors ligne"
        value={String(summary.offlineChairs)}
        muted={summary.offlineChairs === 0}
        accent={summary.offlineChairs > 0 ? 'red' : 'none'}
      />
    </div>
  );
}
