'use client';

import { UserRound, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import type { DashboardCurrentShift, OpenShift } from '@/lib/types';
import { formatDH, formatTimeHHMM } from '@/lib/format';

interface Props {
  currentShift: DashboardCurrentShift | null;
  openShift:    OpenShift | null;
}

export function ShiftSummary({ currentShift, openShift }: Props) {
  const hasShift = !!(currentShift ?? openShift);

  if (!hasShift) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
        <div className="shrink-0 rounded-xl bg-amber-500/20 p-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-300">Aucun shift actif</p>
          <p className="mt-0.5 text-xs text-amber-400/70">
            Les sessions ne seront pas liées à un quart de travail.
          </p>
        </div>
      </div>
    );
  }

  const staffName   = currentShift?.staffMemberName ?? openShift?.staffMemberName ?? '—';
  const shiftLabel  = currentShift?.shiftTypeLabel;
  const startedAt   = currentShift?.startedAt ?? openShift?.startedAt ?? '';
  const scheduledEnd = currentShift?.scheduledEndAt;
  const gross       = currentShift?.grossRevenue;
  const net         = currentShift?.netRevenue;

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        {/* Left: staff name + shift type */}
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-xl bg-emerald-500/15 p-2">
            <UserRound className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shift actif</p>
            <p className="text-sm font-bold text-white">{staffName}</p>
            {shiftLabel && (
              <p className="text-xs text-slate-400">{shiftLabel}</p>
            )}
          </div>
        </div>

        {/* Right: times */}
        <div className="flex items-center gap-4 text-slate-400">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <div className="text-xs">
              <span className="font-medium text-white">{formatTimeHHMM(startedAt)}</span>
              {scheduledEnd && (
                <span className="text-slate-500"> → {formatTimeHHMM(scheduledEnd)}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Revenue row — only when data from REST API */}
      {gross !== undefined && (
        <div className="flex flex-wrap gap-4 border-t border-slate-700/60 px-4 py-2">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3 text-emerald-400" />
            <span className="text-[10px] text-slate-500">Brut</span>
            <span className="text-xs font-semibold text-white">{formatDH(gross ?? 0)}</span>
          </div>
          {net !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500">Net</span>
              <span className="text-xs font-semibold text-emerald-400">{formatDH(net ?? 0)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
