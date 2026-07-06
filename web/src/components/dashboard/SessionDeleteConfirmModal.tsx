'use client';

import { Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SessionDeleteConfirmModal({ open, busy, onCancel, onConfirm }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-xl"
        role="dialog"
        aria-labelledby="delete-session-title"
      >
        <h2 id="delete-session-title" className="text-lg font-semibold text-white">
          Delete session?
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          This action will remove the session from normal application usage.
          If the session affects shifts, bonuses or reports, preserve history safely.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
