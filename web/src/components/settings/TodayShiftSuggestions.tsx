'use client';

import { useState } from 'react';
import { CalendarDays, Clock, Users, Zap } from 'lucide-react';
import type { TodayShiftSuggestion } from '@/lib/types';
import { openShift } from '@/lib/api';

interface Props {
  dayLabel: string;
  suggestions: TodayShiftSuggestion[];
}

export function TodayShiftSuggestions({ dayLabel, suggestions }: Props) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<string>>(new Set());
  const [openError, setOpenError] = useState<string | null>(null);

  async function handleOpen(s: TodayShiftSuggestion) {
    if (!window.confirm(`Ouvrir le shift de ${s.staffMemberName} ?`)) return;
    setOpeningId(s.staffMemberId);
    setOpenError(null);
    try {
      await openShift({
        staffMemberId: s.staffMemberId,
        shiftTypeId: s.shiftTypeId ?? undefined,
      });
      setOpenedIds((prev) => {
        const next = new Set(prev);
        next.add(s.staffMemberId);
        return next;
      });
    } catch (err) {
      setOpenError((err as Error).message);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50/50 px-4 py-3">
        <CalendarDays className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-semibold text-stone-800">
          {"Aujourd'hui"} — {dayLabel}
        </span>
      </div>

      {openError && (
        <div className="mx-4 mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {openError}
        </div>
      )}

      {suggestions.length === 0 ? (
        <p className="py-8 text-center text-sm text-stone-400">
          Aucune suggestion pour aujourd&apos;hui
        </p>
      ) : (
        <ul className="divide-y divide-stone-50">
          {suggestions.map((s) => (
            <li key={s.staffMemberId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100">
                  <Users className="h-4 w-4 text-stone-500" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900">
                    {s.staffMemberName}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {s.shiftTypeLabel && (
                      <span className="text-xs font-medium text-stone-600">{s.shiftTypeLabel}</span>
                    )}
                    {s.startTime && s.endTime && (
                      <>
                        {s.shiftTypeLabel && (
                          <span className="text-xs text-stone-300">·</span>
                        )}
                        <Clock className="h-3 w-3 text-stone-400" />
                        <span className="text-xs text-stone-500">
                          {s.startTime} → {s.endTime}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {openedIds.has(s.staffMemberId) ? (
                <span className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                  Ouvert ✓
                </span>
              ) : (
                <button
                  onClick={() => void handleOpen(s)}
                  disabled={openingId === s.staffMemberId}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
                >
                  <Zap className="h-3 w-3" />
                  {openingId === s.staffMemberId ? '…' : 'Ouvrir'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
