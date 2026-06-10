'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Activity, Wifi, WifiOff, Clock, AlertTriangle } from 'lucide-react';
import type { ChairCardData } from '@/lib/types';
import { getStatusLabel, getStatusStyle } from '@/lib/status';
import { formatElapsed } from '@/lib/format';

interface Props {
  chair: ChairCardData;
}

export function ChairCard({ chair }: Props) {
  const style = getStatusStyle(chair.status);
  const label = getStatusLabel(chair.status);
  const isRunning = chair.status === 'ACTIVE' || chair.status === 'MAYBE_FINISHED';

  // Timestamp converted from a deterministic prop — safe for purity rule
  const sessionStartedAtMs = chair.sessionStartedAt
    ? new Date(chair.sessionStartedAt).getTime()
    : null;

  // Local elapsed state — initialised from backend value, then ticked locally
  const [displayElapsed, setDisplayElapsed] = useState(chair.elapsedSeconds);

  // Tick every second while running. Date.now() lives in the callback, not render body.
  // Display-only: backend remains the source of truth for session duration.
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
      className="block select-none active:opacity-80 transition-opacity duration-75"
    >
    <div
      className={`relative overflow-hidden rounded-2xl border border-stone-100 border-l-4 bg-white shadow-sm transition-shadow hover:shadow-md ${style.accent}`}
    >
      {/* ── Top section ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between p-4 pb-3">
        <div className="flex-1 min-w-0 pr-2">
          {/* Status badge */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot} ${style.pulse ? 'animate-pulse' : ''}`}
            />
            {label}
          </span>

          {/* Chair name */}
          <h3 className="mt-2 text-2xl font-bold leading-none text-stone-900">{chair.name}</h3>

          {/* Display name */}
          {chair.displayName ? (
            <p className="mt-0.5 truncate text-sm text-stone-400">{chair.displayName}</p>
          ) : (
            <p className="mt-0.5 text-sm text-stone-300">Fauteuil</p>
          )}
        </div>

        {/* Chair image */}
        <div className="shrink-0">
          <Image
            src="/feuteuille.jpg"
            alt="Fauteuil de massage"
            width={72}
            height={72}
            className="h-16 w-16 rounded-xl object-contain sm:h-[72px] sm:w-[72px]"
            priority={false}
          />
        </div>
      </div>

      {/* ── Divider ──────────────────────────────────────────────────────────── */}
      <div className="mx-4 border-t border-stone-100" />

      {/* ── Bottom section ───────────────────────────────────────────────────── */}
      <div className="space-y-2 px-4 py-3">
        {/* Power + online row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-stone-600">
            <Activity className="h-3.5 w-3.5 text-stone-400" />
            <span className="text-sm font-semibold">{chair.powerWatts.toFixed(1)} W</span>
          </div>

          <div className="flex items-center gap-1">
            {chair.isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-600">En ligne</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-red-400" />
                <span className="text-xs font-medium text-red-500">Hors ligne</span>
              </>
            )}
          </div>
        </div>

        {/* Session timer (active chairs only) */}
        {isRunning && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-blue-400" />
            <span className="font-mono text-sm font-semibold text-blue-600">
              {formatElapsed(timerValue)}
            </span>
          </div>
        )}

        {/* Warning */}
        {chair.warning && (
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
            <span className="text-xs font-medium text-orange-600">{chair.warning}</span>
          </div>
        )}
      </div>
    </div>
    </Link>
  );
}
