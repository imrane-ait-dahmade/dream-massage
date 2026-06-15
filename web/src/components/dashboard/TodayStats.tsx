'use client';

import { Banknote, BarChart3, Armchair, WifiOff } from 'lucide-react';
import type { TodayStats } from '@/lib/types';
import { formatDH } from '@/lib/format';

interface Props {
  stats: TodayStats;
}

export function TodayStats({ stats }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={<Banknote className="h-5 w-5" />}
        iconClass="bg-emerald-500/20 text-emerald-400"
        label="Revenu attendu"
        value={formatDH(stats.expectedRevenue)}
        accent="emerald"
      />
      <StatCard
        icon={<BarChart3 className="h-5 w-5" />}
        iconClass="bg-blue-500/20 text-blue-400"
        label="Sessions"
        value={String(stats.sessionsCount)}
        accent="blue"
      />
      <StatCard
        icon={<Armchair className="h-5 w-5" />}
        iconClass="bg-violet-500/20 text-violet-400"
        label="Fauteuils actifs"
        value={String(stats.activeChairs)}
        accent="violet"
      />
      <StatCard
        icon={<WifiOff className="h-5 w-5" />}
        iconClass={
          stats.offlineChairs > 0 ? 'bg-red-500/20 text-red-400' : 'bg-slate-600/40 text-slate-500'
        }
        label="Hors ligne"
        value={String(stats.offlineChairs)}
        muted={stats.offlineChairs === 0}
        accent={stats.offlineChairs > 0 ? 'red' : 'none'}
      />
    </div>
  );
}

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
  accent: 'emerald' | 'blue' | 'violet' | 'red' | 'none';
}) {
  const borderMap: Record<string, string> = {
    emerald: 'border-t-2 border-emerald-500/40',
    blue: 'border-t-2 border-blue-500/40',
    violet: 'border-t-2 border-violet-500/40',
    red: 'border-t-2 border-red-500/40',
    none: 'border-t-2 border-slate-700',
  };

  return (
    <div
      className={`rounded-2xl border border-slate-700 bg-slate-800 px-4 py-4 shadow-lg ${borderMap[accent] ?? ''}`}
    >
      <div className={`mb-3 inline-flex rounded-xl p-2 ${iconClass}`}>{icon}</div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${muted ? 'text-slate-600' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}
