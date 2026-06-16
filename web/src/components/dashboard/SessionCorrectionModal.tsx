'use client';

import { useState } from 'react';
import { X, AlertTriangle, CheckCircle } from 'lucide-react';
import type { HomeRecentSession } from '@/lib/types';
import { correctSession } from '@/lib/api';
import { formatDH, formatTime, formatDuration } from '@/lib/format';

interface Props {
  session: HomeRecentSession;
  onClose: () => void;
  onSuccess: () => void;
}

export function SessionCorrectionModal({ session, onClose, onSuccess }: Props) {
  const hasCorrected = session.correctedAmount !== null && session.correctedAmount !== undefined;

  const [amount, setAmount] = useState(
    hasCorrected
      ? String(session.correctedAmount)
      : session.expectedAmount !== null && session.expectedAmount !== undefined
        ? String(session.expectedAmount)
        : '',
  );
  const [reason, setReason] = useState(session.correctionReason ?? '');
  const [notes, setNotes]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [done,   setDone]   = useState(false);

  async function handleSave() {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed < 0) {
      setError('Le montant doit être un nombre valide >= 0.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await correctSession(session.id, {
        correctedAmount:  parsed,
        correctionReason: reason || undefined,
        notes:            notes  || undefined,
      });
      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 700);
    } catch (e) {
      setError((e as Error).message ?? 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    try {
      await correctSession(session.id, {
        clearCorrection:  true,
        correctionReason: reason || 'Annulation correction',
      });
      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 700);
    } catch (e) {
      setError((e as Error).message ?? "Erreur lors de l'annulation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-x-4 top-1/2 z-50 -translate-y-1/2 rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <h2 className="font-bold text-white">Corriger le prix</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Session info */}
          <div className="space-y-1 rounded-xl bg-slate-800 px-4 py-3 text-sm">
            <p className="font-semibold text-white">{session.chairName}</p>
            <p className="text-slate-400">
              {formatTime(session.startedAt)} → {formatTime(session.endedAt)}
              {session.durationSeconds !== null && (
                <span className="ml-2 text-slate-500">
                  ({formatDuration(session.durationSeconds)})
                </span>
              )}
            </p>
            {session.matchedPlanName && (
              <p className="text-xs text-slate-500">Plan : {session.matchedPlanName}</p>
            )}
            {session.anomalyType && (
              <p className="text-xs text-orange-400">Anomalie : {session.anomalyType}</p>
            )}
          </div>

          {/* Expected amount (readonly) */}
          <div className="flex items-center justify-between rounded-xl bg-slate-800/50 px-4 py-2.5">
            <span className="text-sm text-slate-500">Prix calculé automatiquement</span>
            <span className="font-semibold text-slate-300">
              {session.expectedAmount !== null && session.expectedAmount !== undefined
                ? formatDH(session.expectedAmount)
                : '—'}
            </span>
          </div>

          {/* Corrected amount input */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Prix corrigé (DH)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ex: 25"
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          </div>

          {/* Reason */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Raison
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Raison de la correction…"
              rows={2}
              className="w-full resize-none rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Notes (optionnel)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes additionnelles…"
              rows={2}
              className="w-full resize-none rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Success */}
          {done && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <p className="text-sm text-emerald-400">Correction enregistrée.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-700 px-5 py-4">
          <div>
            {hasCorrected && (
              <button
                onClick={() => void handleClear()}
                disabled={saving || done}
                className="rounded-xl border border-orange-500/30 px-3 py-1.5 text-xs font-semibold text-orange-400 hover:border-orange-500/60 hover:bg-orange-500/10 disabled:opacity-40"
              >
                Effacer correction
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40"
            >
              Annuler
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || done}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
