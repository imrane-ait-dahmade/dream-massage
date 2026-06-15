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
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-4">
        <div className="mt-0.5 rounded-xl bg-amber-500/20 p-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
        </div>
        <div>
          <p className="font-semibold text-amber-300">Aucun shift ouvert</p>
          <p className="mt-0.5 text-sm text-amber-400/70">
            Les sessions ne seront pas liées à un quart de travail.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-800 px-4 py-4 shadow-lg">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-emerald-500/15 p-2">
          <UserRound className="h-4 w-4 text-emerald-400" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Shift ouvert
          </p>
          <p className="mt-0.5 font-semibold text-white">{openShift.staffMemberName}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-slate-400">
        <Clock className="h-3.5 w-3.5" />
        <span className="text-sm font-medium">{formatTimeHHMM(openShift.startedAt)}</span>
      </div>
    </div>
  );
}
