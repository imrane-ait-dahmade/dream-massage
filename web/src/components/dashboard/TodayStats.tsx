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
        iconClass="bg-emerald-100 text-emerald-600"
        label="Revenu attendu"
        value={formatDH(stats.expectedRevenue)}
      />
      <StatCard
        icon={<BarChart3 className="h-5 w-5" />}
        iconClass="bg-blue-100 text-blue-600"
        label="Sessions"
        value={String(stats.sessionsCount)}
      />
      <StatCard
        icon={<Armchair className="h-5 w-5" />}
        iconClass="bg-violet-100 text-violet-600"
        label="Fauteuils actifs"
        value={String(stats.activeChairs)}
      />
      <StatCard
        icon={<WifiOff className="h-5 w-5" />}
        iconClass={stats.offlineChairs > 0 ? 'bg-red-100 text-red-500' : 'bg-stone-100 text-stone-400'}
        label="Hors ligne"
        value={String(stats.offlineChairs)}
        muted={stats.offlineChairs === 0}
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
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-stone-100">
      <div className={`mb-3 inline-flex rounded-xl p-2 ${iconClass}`}>{icon}</div>
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${muted ? 'text-stone-400' : 'text-stone-900'}`}>
        {value}
      </p>
    </div>
  );
}
