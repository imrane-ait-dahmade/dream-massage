'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import type { SessionPlanChangeRequest } from '@/lib/types';
import {
  ApiError,
  approveSessionPlanChangeRequest,
  rejectSessionPlanChangeRequest,
} from '@/lib/api';
import { formatDH, formatTime } from '@/lib/format';
import {
  amountDiff,
  computeRemainingAmount,
  formatAmountDiff,
  formatPlanMinutes,
} from '@/lib/plan-change';

type Mode = 'approve' | 'reject';

interface Props {
  request: SessionPlanChangeRequest;
  mode: Mode;
  onClose: () => void;
  onSuccess: () => void;
}

export function PlanChangeReviewModal({ request, mode, onClose, onSuccess }: Props) {
  const [reviewNote, setReviewNote] = useState('');
  const [confirming, setConfirming] = useState(mode === 'reject');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const oldAmt = request.originalExpectedAmount;
  const newAmt = request.requestedExpectedAmount;
  const diff = amountDiff(oldAmt, newAmt);
  const paid = request.session.correctedAmount;
  const remaining = computeRemainingAmount(newAmt, paid);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (mode === 'approve') {
        await approveSessionPlanChangeRequest(request.id, {
          reviewNote: reviewNote.trim() || undefined,
        });
      } else {
        await rejectSessionPlanChangeRequest(request.id, {
          reviewNote: reviewNote.trim() || undefined,
        });
      }
      setDone(true);
      window.setTimeout(() => {
        onSuccess();
        onClose();
      }, 700);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 z-50 max-h-[90vh] -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <h2 className="font-bold text-white">
            {mode === 'approve' ? 'Valider la demande' : 'Refuser la demande'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-sm">
          <div className="rounded-xl bg-slate-800 px-4 py-3">
            <p className="font-semibold text-white">{request.session.chairName}</p>
            <p className="text-xs text-slate-400">
              Session {request.session.status} · {formatTime(request.session.startedAt)} →{' '}
              {formatTime(request.session.endedAt)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Demande du {new Date(request.createdAt).toLocaleString('fr-FR')} par{' '}
              {request.requestedBy?.name ?? 'Assistant'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 font-mono text-xs text-slate-200">
            <p>
              Plan actuel → Nouveau plan
            </p>
            <p className="mt-1">
              {request.originalPlanName ?? '—'} ({formatPlanMinutes(request.originalDurationSeconds)})
              {' → '}
              {request.requestedPlanName} ({formatPlanMinutes(request.requestedDurationSeconds)})
            </p>
            <p className="mt-1">
              {oldAmt != null ? formatDH(oldAmt) : '—'} → {newAmt != null ? formatDH(newAmt) : '—'}{' '}
              ({formatAmountDiff(diff)})
            </p>
            {paid != null && (
              <>
                <p className="mt-2">Montant payé : {formatDH(paid)}</p>
                <p>Nouveau reste à payer : {formatDH(remaining)}</p>
              </>
            )}
          </div>

          <div className="rounded-xl bg-slate-800/40 px-4 py-3 text-xs text-slate-300">
            <p className="font-semibold text-slate-200">Raison de l’Assistant</p>
            <p className="mt-1 whitespace-pre-wrap">{request.reason}</p>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Remarque {mode === 'reject' ? '(recommandée)' : '(optionnelle)'}
            </label>
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none"
              placeholder={
                mode === 'approve'
                  ? 'Modification validée après vérification…'
                  : 'Demande refusée car…'
              }
            />
          </div>

          {mode === 'approve' && confirming && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
              Confirmez-vous l’application du nouveau plan sur cette session ? Cette action est
              définitive pour cette demande.
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <p className="text-sm text-emerald-400">
                {mode === 'approve' ? 'Demande validée.' : 'Demande refusée.'}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-700 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-400 hover:bg-slate-800 disabled:opacity-40"
          >
            Annuler
          </button>
          {mode === 'approve' && !confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={saving || done || request.status !== 'PENDING'}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              Valider
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || done || request.status !== 'PENDING'}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ${
                mode === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-red-600 hover:bg-red-500'
              }`}
            >
              {saving
                ? 'Traitement…'
                : mode === 'approve'
                  ? 'Confirmer la validation'
                  : 'Confirmer le refus'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
