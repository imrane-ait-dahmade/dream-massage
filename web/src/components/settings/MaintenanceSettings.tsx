'use client';

import { useState, useEffect } from 'react';
import { Shield, Database } from 'lucide-react';
import {
  getBackupInstructions,
  bulkArchiveInactiveStaff,
  bulkArchiveOrphanSchedules,
} from '@/lib/api';

export function MaintenanceSettings() {
  const [backup, setBackup] = useState<{
    pgDump: string;
    neon: string;
    note: string;
  } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBackupInstructions().then(setBackup).catch(() => {});
  }, []);

  async function runBulk(
    action: 'staff' | 'schedules',
  ) {
    if (confirmation !== 'ARCHIVE') {
      setMsg('Tapez ARCHIVE pour confirmer.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const result = action === 'staff'
        ? await bulkArchiveInactiveStaff(confirmation, reason || undefined)
        : await bulkArchiveOrphanSchedules(confirmation, reason || undefined);
      setMsg(`Terminé : ${result.archived} / ${result.candidateCount} candidat(s).`);
      setConfirmation('');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
        <Shield className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Réservé au propriétaire (OWNER). Créez une sauvegarde avant toute suppression définitive ou nettoyage en masse.
        </p>
      </div>

      {backup && (
        <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold text-stone-800">
            <Database className="h-4 w-4" />
            Sauvegarde recommandée
          </div>
          <pre className="overflow-x-auto rounded-lg bg-stone-50 p-2 text-xs text-stone-600">{backup.pgDump}</pre>
          <p className="mt-2 text-xs text-stone-500">{backup.neon}</p>
          <p className="mt-1 text-xs text-stone-400">{backup.note}</p>
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
        <p className="text-sm font-semibold text-stone-800">Nettoyage sécurisé</p>
        <label className="block text-xs text-stone-500">Confirmation (tapez ARCHIVE)</label>
        <input
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className="w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm"
        />
        <label className="block text-xs text-stone-500">Motif (optionnel)</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm"
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBulk('staff')}
            className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Archiver le staff inactif sans historique
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBulk('schedules')}
            className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 disabled:opacity-50"
          >
            Archiver le planning orphelin (staff archivé)
          </button>
        </div>
        {msg && <p className="text-xs text-stone-600">{msg}</p>}
      </div>
    </div>
  );
}
