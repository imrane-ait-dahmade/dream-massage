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
      <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-4 ring-1 ring-amber-200">
        <div className="mt-0.5 rounded-xl bg-amber-100 p-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        </div>
        <div>
          <p className="font-semibold text-amber-800">Aucun shift ouvert</p>
          <p className="mt-0.5 text-sm text-amber-700 opacity-80">
            Les sessions ne seront pas liées à un quart de travail.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-stone-100">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-emerald-100 p-2">
          <UserRound className="h-4 w-4 text-emerald-600" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
            Shift ouvert
          </p>
          <p className="mt-0.5 font-semibold text-stone-800">{openShift.staffMemberName}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-stone-500">
        <Clock className="h-3.5 w-3.5" />
        <span className="text-sm font-medium">{formatTimeHHMM(openShift.startedAt)}</span>
      </div>
    </div>
  );
}
