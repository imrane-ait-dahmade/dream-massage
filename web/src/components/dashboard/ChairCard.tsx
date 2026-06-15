'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Activity, Wifi, WifiOff, Clock, AlertTriangle } from 'lucide-react';
import type { ChairCardData } from '@/lib/types';
import { getStatusLabel, getDarkStatusStyle } from '@/lib/status';
import { formatElapsed } from '@/lib/format';

interface Props {
  chair: ChairCardData;
}

export function ChairCard({ chair }: Props) {
  const style = getDarkStatusStyle(chair.status);
  const label = getStatusLabel(chair.status);
  const isRunning = chair.status === 'ACTIVE' || chair.status === 'MAYBE_FINISHED';

  const sessionStartedAtMs = chair.sessionStartedAt
    ? new Date(chair.sessionStartedAt).getTime()
    : null;

  // Tick locally for display — backend remains source of truth for billing duration
  const [displayElapsed, setDisplayElapsed] = useState(chair.elapsedSeconds);

  useEffect(() => {
    if (!isRunning || sessionStartedAtMs === null) return;
    const id = setInterval(() => {
      setDisplayElapsed(Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning, sessionStartedAtMs]);

  const timerValue = isRunning ? displayElapsed : chair.elapsedSeconds;

  return (
    <Link
      href={`/chairs/${chair.id}`}
      className="block select-none transition-opacity active:opacity-75"
    >
      <div
        className={`relative overflow-hidden rounded-2xl border border-slate-700 border-l-4 bg-slate-800 shadow-lg transition-shadow hover:shadow-slate-900 hover:border-slate-600 ${style.accent}`}
      >
        {/* Top: name + status */}
        <div className="p-4 pb-3">
          {/* Status badge */}
          <div className="mb-2.5 flex items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${style.dot} ${style.pulse ? 'animate-pulse' : ''}`}
            />
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.badge}`}>
              {label}
            </span>
          </div>

          {/* Chair name */}
          <h3 className="text-2xl font-bold leading-none text-white">{chair.name}</h3>

          {chair.displayName ? (
            <p className="mt-0.5 truncate text-xs text-slate-500">{chair.displayName}</p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-600">Fauteuil</p>
          )}
        </div>

        <div className="mx-4 border-t border-slate-700/60" />

        {/* Bottom: metrics */}
        <div className="space-y-2 px-4 py-3">
          {/* Power + online */}
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

          {/* Session timer */}
          {isRunning && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-blue-400" />
              <span className="font-mono text-xs font-bold text-blue-400">
                {formatElapsed(timerValue)}
              </span>
            </div>
          )}

          {/* Warning */}
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
