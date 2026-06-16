'use client';

import { UserRound, Clock, AlertTriangle } from 'lucide-react';
import type { OpenShift } from '@/lib/types';
import { formatTimeHHMM } from '@/lib/format';

interface Props {
  openShift: OpenShift | null;
}

export function ShiftSummary({ openShift }: Props) {
  if (!openShift) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 md:rounded-2xl md:gap-3 md:px-4 md:py-4">
        <div className="shrink-0 rounded-lg bg-amber-500/20 p-1.5 md:rounded-xl md:p-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 md:h-4 md:w-4" />
        </div>
        <div>
          <p className="text-xs font-semibold text-amber-300 md:text-sm">Aucun shift ouvert</p>
          <p className="hidden text-xs text-amber-400/70 md:block">
            Les sessions ne seront pas liées à un quart de travail.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 shadow-lg md:rounded-2xl md:px-4 md:py-4">
      <div className="flex items-center gap-2 md:gap-3">
        <div className="shrink-0 rounded-lg bg-emerald-500/15 p-1.5 md:rounded-xl md:p-2">
          <UserRound className="h-3.5 w-3.5 text-emerald-400 md:h-4 md:w-4" />
        </div>
        <div>
          <p className="hidden text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:block">
            Shift ouvert
          </p>
          <p className="text-xs font-semibold text-white md:text-sm">{openShift.staffMemberName}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 text-slate-400">
        <Clock className="h-3 w-3 md:h-3.5 md:w-3.5" />
        <span className="text-xs font-medium">{formatTimeHHMM(openShift.startedAt)}</span>
      </div>
    </div>
  );
}
