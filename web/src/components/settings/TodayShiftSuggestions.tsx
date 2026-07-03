'use client';

import { CalendarDays, Clock, Users } from 'lucide-react';
import type { TodayShiftSuggestion, TodayShiftStatus } from '@/lib/types';

interface Props {
  dayLabel: string;
  autoShiftEnabled: boolean;
  suggestions: TodayShiftSuggestion[];
}

const STATUS_LABEL: Record<TodayShiftStatus, string> = {
  upcoming:  'À venir',
  active:    'Actif',
  completed: 'Terminé',
  rest:      'Repos',
};

const STATUS_CLASS: Record<TodayShiftStatus, string> = {
  upcoming:  'bg-sky-100 text-sky-700',
  active:    'bg-green-100 text-green-700',
  completed: 'bg-stone-100 text-stone-500',
  rest:      'bg-stone-50 text-stone-400',
};

export function TodayShiftSuggestions({ dayLabel, autoShiftEnabled, suggestions }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Les shifts sont ouverts et fermés automatiquement selon le planning.
        {!autoShiftEnabled && (
          <span className="mt-1 block text-xs font-medium text-amber-700">
            Attention : l&apos;auto-shift est désactivé sur le serveur (AUTO_SHIFT_ENABLED=false).
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50/50 px-4 py-3">
          <CalendarDays className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold text-stone-800">
            {"Aujourd'hui"} — {dayLabel}
          </span>
        </div>

        {suggestions.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-400">
            Aucune entrée de planning pour aujourd&apos;hui
          </p>
        ) : (
          <ul className="divide-y divide-stone-50">
            {suggestions.map((s) => (
              <li key={s.scheduleId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100">
                    <Users className="h-4 w-4 text-stone-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-900">
                      {s.staffMemberName}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
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

                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASS[s.status]}`}
                >
                  {STATUS_LABEL[s.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
