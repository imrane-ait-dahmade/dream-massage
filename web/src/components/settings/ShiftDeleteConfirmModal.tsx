'use client';

import { Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  busy: boolean;
  staffName?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ShiftDeleteConfirmModal({ open, busy, staffName, onCancel, onConfirm }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-5 shadow-xl"
        role="dialog"
        aria-labelledby="delete-shift-title"
      >
        <h2 id="delete-shift-title" className="text-lg font-semibold text-stone-900">
          Supprimer ce shift ?
        </h2>
        {staffName && (
          <p className="mt-1 text-sm font-medium text-stone-600">{staffName}</p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          Voulez-vous vraiment supprimer ce shift ? Cette action est définitive.
        </p>
        <p className="mt-2 text-xs text-stone-500">
          Les sessions liées seront conservées et détachées de ce shift.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {busy ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}
