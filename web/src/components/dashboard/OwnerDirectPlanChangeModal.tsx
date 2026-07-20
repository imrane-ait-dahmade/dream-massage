'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import type { HomeRecentSession, PricingPlan } from '@/lib/types';
import { ApiError, changeSessionPlan, getPricingPlans } from '@/lib/api';
import { formatDH, formatTime } from '@/lib/format';
import {
  amountDiff,
  computeRemainingAmount,
  formatAmountDiff,
  formatPlanMinutes,
} from '@/lib/plan-change';

interface Props {
  session: HomeRecentSession;
  onClose: () => void;
  onSuccess: () => void;
}

export function OwnerDirectPlanChangeModal({ session, onClose, onSuccess }: Props) {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [requestedPlanId, setRequestedPlanId] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getPricingPlans()
      .then((r) => setPlans((r.items ?? []).filter((p) => p.isActive)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingPlans(false));
  }, []);

  const selectable = useMemo(
    () => plans.filter((p) => p.id !== session.matchedPlanId),
    [plans, session.matchedPlanId],
  );
  const selected = selectable.find((p) => p.id === requestedPlanId) ?? null;
  const currentExpected = session.expectedAmount;
  const newExpected = selected?.priceAmount ?? null;
  const diff = amountDiff(currentExpected, newExpected);
  const paid = session.correctedAmount;
  const remaining = computeRemainingAmount(newExpected, paid);

  async function handleConfirm() {
    if (!requestedPlanId || !selected) {
      setError('Veuillez sélectionner un nouveau plan.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changeSessionPlan(session.id, {
        requestedPlanId,
        reason: reason.trim() || undefined,
      });
      setDone(true);
      window.setTimeout(() => {
        onSuccess();
        onClose();
      }, 700);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg);
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 z-50 max-h-[90vh] -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <h2 className="font-bold text-white">Modifier le plan</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-xl bg-slate-800 px-4 py-3 text-sm">
            <p className="font-semibold text-white">{session.chairName}</p>
            <p className="text-slate-400">
              {formatTime(session.startedAt)} → {formatTime(session.endedAt)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Plan actuel : {session.matchedPlanName ?? '—'} ·{' '}
              {currentExpected != null ? formatDH(currentExpected) : '—'}
            </p>
          </div>

          {!confirming ? (
            <>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Nouveau plan
                </label>
                {loadingPlans ? (
                  <p className="text-xs text-slate-500">Chargement…</p>
                ) : (
                  <select
                    value={requestedPlanId}
                    onChange={(e) => setRequestedPlanId(e.target.value)}
                    className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Sélectionner…</option>
                    {selectable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatPlanMinutes(p.durationSeconds)} — {formatDH(p.priceAmount)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selected && (
                <div className="space-y-1 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-xs text-slate-300">
                  <p>
                    {session.matchedPlanName ?? '—'} ({currentExpected != null ? formatDH(currentExpected) : '—'})
                    {' → '}
                    <span className="font-semibold text-white">
                      {selected.name} ({formatDH(selected.priceAmount)})
                    </span>
                  </p>
                  <p>Différence : {formatAmountDiff(diff)}</p>
                  {paid != null && (
                    <>
                      <p>Montant enregistré : {formatDH(paid)}</p>
                      <p>Nouveau reste à payer : {formatDH(remaining)}</p>
                    </>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Raison (optionnel)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                  placeholder="Motif de la modification…"
                />
              </div>
            </>
          ) : (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <p className="font-semibold">Confirmer la modification directe ?</p>
              <p className="text-xs">
                {session.matchedPlanName ?? '—'} → {selected?.name}
              </p>
              <p className="text-xs">
                {currentExpected != null ? formatDH(currentExpected) : '—'} →{' '}
                {newExpected != null ? formatDH(newExpected) : '—'} ({formatAmountDiff(diff)})
              </p>
              {paid != null && (
                <p className="text-xs">
                  Montant enregistré : {formatDH(paid)} · reste : {formatDH(remaining)}
                </p>
              )}
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
              <p className="text-sm text-emerald-400">Plan modifié.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-700 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40"
          >
            Annuler
          </button>
          {!confirming ? (
            <button
              type="button"
              onClick={() => {
                if (!requestedPlanId) {
                  setError('Veuillez sélectionner un nouveau plan.');
                  return;
                }
                setError(null);
                setConfirming(true);
              }}
              disabled={saving || done || loadingPlans}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              Continuer
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={saving || done}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {saving ? 'Application…' : 'Confirmer'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
