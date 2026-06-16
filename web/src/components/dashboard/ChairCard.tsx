'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Activity, Wifi, WifiOff, Clock, AlertTriangle } from 'lucide-react';
import type { ChairCardData } from '@/lib/types';
import { getStatusLabel, getDarkStatusStyle } from '@/lib/status';
import { formatElapsed } from '@/lib/format';

const STATUS_LABEL_FR: Record<string, string> = {
  IDLE:           'Disponible',
  MAYBE_ACTIVE:   'Démarrage',
  ACTIVE:         'Actif',
  MAYBE_FINISHED: 'Fin possible',
  OFFLINE:        'Hors ligne',
  ERROR:          'Erreur',
  MAINTENANCE:    'Maintenance',
};

interface Props {
  chair: ChairCardData;
  compact?: boolean;
}

export function ChairCard({ chair, compact = false }: Props) {
  const style = getDarkStatusStyle(chair.status);
  const label = STATUS_LABEL_FR[chair.status] ?? getStatusLabel(chair.status);
  const isRunning = chair.status === 'ACTIVE' || chair.status === 'MAYBE_FINISHED';

  const sessionStartedAtMs = chair.sessionStartedAt
    ? new Date(chair.sessionStartedAt).getTime()
    : null;

  const [displayElapsed, setDisplayElapsed] = useState(chair.elapsedSeconds);

  useEffect(() => {
    if (!isRunning || sessionStartedAtMs === null) return;
    const id = setInterval(() => {
      setDisplayElapsed(Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning, sessionStartedAtMs]);

  const timerValue = isRunning ? displayElapsed : chair.elapsedSeconds;

  if (compact) {
    return (
      <Link href={`/chairs/${chair.id}`} className="block select-none transition-opacity active:opacity-75">
        <div className={`relative h-full rounded-2xl border border-slate-700 border-l-4 bg-slate-800/80 transition-colors hover:bg-slate-800 ${style.accent}`}>

          {/* Mobile: 2-col friendly compact layout */}
          <div className="px-3 py-2.5 md:hidden">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot} ${style.pulse ? 'animate-pulse' : ''}`} />
                <span className="text-base font-bold leading-none text-white">{chair.name}</span>
              </div>
              {chair.isOnline ? (
                <Wifi className="h-3 w-3 shrink-0 text-emerald-400" />
              ) : (
                <WifiOff className="h-3 w-3 shrink-0 text-red-400" />
              )}
            </div>
            <div className="mt-1.5">
              <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${style.badge}`}>
                {label}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-1">
              <span className="text-[10px] text-slate-500 tabular-nums">{chair.powerWatts.toFixed(0)}W</span>
              {isRunning && (
                <span className="font-mono text-xs font-bold tabular-nums text-blue-400">
                  {formatElapsed(timerValue)}
                </span>
              )}
            </div>
            {chair.warning && (
              <div className="mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0 text-orange-400" />
                <span className="truncate text-[9px] font-medium text-orange-400">{chair.warning}</span>
              </div>
            )}
          </div>

          {/* Desktop compact layout (5-per-row) */}
          <div className="hidden px-3 py-2.5 md:block">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot} ${style.pulse ? 'animate-pulse' : ''}`} />
                <span className="text-sm font-bold leading-none text-white">{chair.name}</span>
              </div>
              {isRunning && (
                <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-blue-400">
                  {formatElapsed(timerValue)}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${style.badge}`}>{label}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-[10px] text-slate-600">{chair.powerWatts.toFixed(0)}W</span>
                {chair.isOnline ? (
                  <Wifi className="h-2.5 w-2.5 text-emerald-400" />
                ) : (
                  <WifiOff className="h-2.5 w-2.5 text-red-400" />
                )}
              </div>
            </div>
            {chair.warning && (
              <div className="mt-1 flex items-center gap-1">
                <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-orange-400" />
                <span className="truncate text-[9px] font-medium text-orange-400">{chair.warning}</span>
              </div>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // Full card (chair detail page)
  return (
    <Link
      href={`/chairs/${chair.id}`}
      className="block select-none transition-opacity active:opacity-75"
    >
      <div
        className={`relative overflow-hidden rounded-2xl border border-slate-700 border-l-4 bg-slate-800 shadow-lg transition-shadow hover:shadow-slate-900 hover:border-slate-600 ${style.accent}`}
      >
        <div className="p-4 pb-3">
          <div className="mb-2.5 flex items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${style.dot} ${style.pulse ? 'animate-pulse' : ''}`}
            />
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.badge}`}>
              {label}
            </span>
          </div>
          <h3 className="text-2xl font-bold leading-none text-white">{chair.name}</h3>
          {chair.displayName ? (
            <p className="mt-0.5 truncate text-xs text-slate-500">{chair.displayName}</p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-600">Fauteuil</p>
          )}
        </div>

        <div className="mx-4 border-t border-slate-700/60" />

        <div className="space-y-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-slate-500" />
              <span className="text-xs font-semibold text-slate-300">
                {chair.powerWatts.toFixed(1)} W
              </span>
            </div>
            <div className="flex items-center gap-1">
              {chair.isOnline ? (
                <>
                  <Wifi className="h-3 w-3 text-emerald-400" />
                  <span className="text-[10px] font-medium text-emerald-400">En ligne</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 text-red-400" />
                  <span className="text-[10px] font-medium text-red-400">Hors ligne</span>
                </>
              )}
            </div>
          </div>

          {isRunning && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-blue-400" />
              <span className="font-mono text-xs font-bold text-blue-400">
                {formatElapsed(timerValue)}
              </span>
            </div>
          )}

          {chair.warning && (
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-orange-400" />
              <span className="text-[10px] font-medium text-orange-400">{chair.warning}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
