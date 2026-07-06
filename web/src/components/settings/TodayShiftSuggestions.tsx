'use client';

import { useState } from 'react';
import { CalendarDays, Clock, Users, AlertTriangle, Trash2, CheckCircle, XCircle, X } from 'lucide-react';
import type { TodayShiftSuggestion, TodayShiftStatus } from '@/lib/types';
import { deleteShift } from '@/lib/api';
import { ShiftDeleteConfirmModal } from './ShiftDeleteConfirmModal';

interface Props {
  dayLabel: string;
  autoShiftEnabled: boolean;
  suggestions: TodayShiftSuggestion[];
  onRefresh: () => void;
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

export function TodayShiftSuggestions({ dayLabel, autoShiftEnabled, suggestions, onRefresh }: Props) {
  const [pendingDelete, setPendingDelete] = useState<TodayShiftSuggestion | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const workingToday = suggestions.filter((s) => s.status !== 'rest');

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  async function confirmDelete() {
    if (!pendingDelete?.shiftId) return;
    setDeleting(true);
    try {
      await deleteShift(pendingDelete.shiftId);
      setPendingDelete(null);
      showToast('success', 'Shift supprimé définitivement.');
      onRefresh();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Échec de la suppression.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      {toast && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
            toast.type === 'success'
              ? 'border-green-100 bg-green-50 text-green-700'
              : 'border-red-100 bg-red-50 text-red-600'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          {toast.message}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-auto shrink-0 hover:opacity-70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
        <p>
          Le shift automatique utilise ce planning avec ouverture à{' '}
          <strong>08:00</strong> et fermeture à <strong>23:45</strong> (Africa/Casablanca).
        </p>
        {!autoShiftEnabled && (
          <p className="mt-2 text-xs font-medium text-amber-700">
            L&apos;auto-shift est désactivé sur le serveur (AUTO_SHIFT_ENABLED=false).
          </p>
        )}
      </div>

      {workingToday.length === 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Aucun planning défini pour aujourd&apos;hui. L&apos;ouverture automatique ne pourra pas créer de shift.
          </p>
        </div>
      )}

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
                      {s.shiftTypeLabel && s.status !== 'rest' && (
                        <span className="text-xs font-medium text-stone-600">{s.shiftTypeLabel}</span>
                      )}
                      {s.startTime && s.endTime && (
                        <>
                          {s.shiftTypeLabel && s.status !== 'rest' && (
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

                <div className="flex shrink-0 items-center gap-2">
                  {s.shiftId && (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(s)}
                      className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      title="Supprimer le shift"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASS[s.status]}`}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ShiftDeleteConfirmModal
        open={pendingDelete != null}
        busy={deleting}
        staffName={pendingDelete?.staffMemberName}
        onCancel={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
