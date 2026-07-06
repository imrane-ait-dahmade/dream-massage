'use client';

import { useState } from 'react';
import { Archive, RotateCcw, Trash2, MoreVertical } from 'lucide-react';

interface Props {
  isArchived: boolean;
  canHardDelete?: boolean;
  hardDeleteBlockers?: string[];
  showReactivateUser?: boolean;
  onArchive: (reason: string, reactivateLinkedUser?: boolean) => Promise<void>;
  onRestore: (reactivateLinkedUser?: boolean) => Promise<void>;
  onHardDelete?: () => Promise<void>;
}

export function ArchiveActionMenu({
  isArchived,
  canHardDelete = false,
  hardDeleteBlockers = [],
  showReactivateUser = false,
  onArchive,
  onRestore,
  onHardDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [reactivateUser, setReactivateUser] = useState(true);
  const [confirmHard, setConfirmHard] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setOpen(false);
      setConfirmHard(false);
      setReason('');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
        title="Actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="relative">
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-stone-200 bg-white p-3 shadow-lg">
        {!confirmHard ? (
          <>
            <label className="mb-2 block text-xs text-stone-500">Motif (optionnel)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ex: départ, doublon test…"
              className="mb-3 w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm"
            />
            {showReactivateUser && isArchived && (
              <label className="mb-3 flex items-center gap-2 text-xs text-stone-600">
                <input
                  type="checkbox"
                  checked={reactivateUser}
                  onChange={(e) => setReactivateUser(e.target.checked)}
                />
                Réactiver le compte assistant lié
              </label>
            )}
            <div className="flex flex-col gap-1.5">
              {!isArchived ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => onArchive(reason))}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-50"
                >
                  <Archive className="h-4 w-4" />
                  Archiver
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => onRestore(showReactivateUser ? reactivateUser : undefined))}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Restaurer
                </button>
              )}
              {canHardDelete && onHardDelete && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmHard(true)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Supprimer définitivement
                </button>
              )}
              {!canHardDelete && hardDeleteBlockers.length > 0 && (
                <p className="px-1 text-[11px] text-stone-400">
                  Suppression bloquée : {hardDeleteBlockers.join(', ')}
                </p>
              )}
            </div>
            <p className="mt-2 text-[11px] text-stone-400">
              {isArchived
                ? 'La restauration rendra cette donnée visible dans l\'app.'
                : 'Cette donnée sera masquée de l\'application mais restera dans l\'historique.'}
            </p>
          </>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium text-red-700">Suppression définitive</p>
            <p className="mb-3 text-xs text-stone-500">
              Cette action est irréversible. Créez une sauvegarde avant toute suppression en production.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onHardDelete!())}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Confirmer
              </button>
              <button
                type="button"
                onClick={() => setConfirmHard(false)}
                className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs"
              >
                Annuler
              </button>
            </div>
          </>
        )}
        <button
          type="button"
          onClick={() => { setOpen(false); setConfirmHard(false); }}
          className="mt-2 w-full pt-2 text-center text-xs text-stone-400"
        >
          Fermer
        </button>
      </div>
      <button type="button" className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-label="Fermer" />
    </div>
  );
}
