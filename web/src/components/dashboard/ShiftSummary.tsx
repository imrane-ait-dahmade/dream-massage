'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Circle, Settings2 } from 'lucide-react';
import type { DashboardCurrentShift } from '@/lib/types';
import { getShiftAutomationStatus } from '@/lib/api';
import { formatTimeHHMM } from '@/lib/format';

interface Props {
  currentShift: DashboardCurrentShift | null;
}

export function ShiftSummary({ currentShift }: Props) {
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  useEffect(() => {
    getShiftAutomationStatus()
      .then((s) => setLastCheck(s.lastRunAt))
      .catch(() => {});
  }, []);

  const isActive = !!currentShift;

  return (
    <div
      className={
        isActive
          ? 'rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3'
          : 'rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={
              isActive
                ? 'rounded-lg bg-emerald-500/15 p-2'
                : 'rounded-lg bg-slate-700/80 p-2'
            }
          >
            <Circle
              className={`h-3 w-3 ${isActive ? 'fill-emerald-400 text-emerald-400' : 'fill-slate-500 text-slate-500'}`}
            />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              {isActive ? 'Shift actif' : 'Aucun shift actif'}
            </p>
            {isActive && currentShift && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                {currentShift.staffMemberName && (
                  <span>{currentShift.staffMemberName}</span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Ouvert {formatTimeHHMM(currentShift.startedAt)}
                </span>
                {currentShift.scheduledEndAt && (
                  <span>Fin prévue {formatTimeHHMM(currentShift.scheduledEndAt)}</span>
                )}
              </div>
            )}
            {lastCheck && (
              <p className="mt-1 text-[10px] text-slate-500">
                Dernière vérif. auto : {formatTimeHHMM(lastCheck)}
              </p>
            )}
          </div>
        </div>

        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Voir paramétrage
        </Link>
      </div>
    </div>
  );
}
