'use client';

import {
  Banknote,
  TrendingDown,
  BarChart3,
  AlertTriangle,
  Armchair,
  WifiOff,
  DollarSign,
} from 'lucide-react';
import type { HomeSummary } from '@/lib/types';
import { formatDH } from '@/lib/format';

// ── Single stat card ───────────────────────────────────────────────────────────

type Accent = 'emerald' | 'teal' | 'blue' | 'violet' | 'red' | 'orange' | 'amber' | 'none';

const BORDER: Record<Accent, string> = {
  emerald: 'border-t-2 border-emerald-500/40',
  teal:    'border-t-2 border-teal-500/40',
  blue:    'border-t-2 border-blue-500/40',
  violet:  'border-t-2 border-violet-500/40',
  red:     'border-t-2 border-red-500/40',
  orange:  'border-t-2 border-orange-500/40',
  amber:   'border-t-2 border-amber-500/40',
  none:    'border-t-2 border-slate-700',
};

function StatCard({
  icon,
  iconClass,
  label,
  value,
  muted = false,
  accent,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  muted?: boolean;
  accent: Accent;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-700 bg-slate-800 px-4 py-4 shadow-lg ${BORDER[accent]}`}
    >
      <div className={`mb-3 inline-flex rounded-xl p-2 ${iconClass}`}>{icon}</div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${muted ? 'text-slate-600' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-slate-700 border-t-2 border-t-slate-700 bg-slate-800 px-4 py-4 shadow-lg">
      <div className="mb-3 h-9 w-9 animate-pulse rounded-xl bg-slate-700" />
      <div className="h-3 w-20 animate-pulse rounded bg-slate-700" />
      <div className="mt-2 h-8 w-24 animate-pulse rounded bg-slate-700" />
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      <StatCard
        icon={<Banknote className="h-5 w-5" />}
        iconClass="bg-emerald-500/20 text-emerald-400"
        label="Revenu brut"
        value={formatDH(summary.grossRevenue)}
        accent="emerald"
      />
      <StatCard
        icon={<TrendingDown className="h-5 w-5" />}
        iconClass="bg-teal-500/20 text-teal-400"
        label="Recette nette"
        value={formatDH(summary.netRevenue)}
        accent="teal"
      />
      <StatCard
        icon={<BarChart3 className="h-5 w-5" />}
        iconClass="bg-blue-500/20 text-blue-400"
        label="Sessions"
        value={String(summary.sessionsCount)}
        accent="blue"
      />
      <StatCard
        icon={<AlertTriangle className="h-5 w-5" />}
        iconClass={
          summary.outOfRuleSessionsCount > 0
            ? 'bg-orange-500/20 text-orange-400'
            : 'bg-slate-600/40 text-slate-500'
        }
        label="Hors règle"
        value={String(summary.outOfRuleSessionsCount)}
        muted={summary.outOfRuleSessionsCount === 0}
        accent={summary.outOfRuleSessionsCount > 0 ? 'orange' : 'none'}
      />
      <StatCard
        icon={<Armchair className="h-5 w-5" />}
        iconClass="bg-violet-500/20 text-violet-400"
        label="Fauteuils actifs"
        value={String(summary.activeChairs)}
        accent="violet"
      />
      <StatCard
        icon={<WifiOff className="h-5 w-5" />}
        iconClass={
          summary.offlineChairs > 0
            ? 'bg-red-500/20 text-red-400'
            : 'bg-slate-600/40 text-slate-500'
        }
        label="Hors ligne"
        value={String(summary.offlineChairs)}
        muted={summary.offlineChairs === 0}
        accent={summary.offlineChairs > 0 ? 'red' : 'none'}
      />
      <StatCard
        icon={<DollarSign className="h-5 w-5" />}
        iconClass={
          summary.totalPrime > 0
            ? 'bg-amber-500/20 text-amber-400'
            : 'bg-slate-600/40 text-slate-500'
        }
        label="Prime totale"
        value={formatDH(summary.totalPrime)}
        muted={summary.totalPrime === 0}
        accent={summary.totalPrime > 0 ? 'amber' : 'none'}
      />
    </div>
  );
}
