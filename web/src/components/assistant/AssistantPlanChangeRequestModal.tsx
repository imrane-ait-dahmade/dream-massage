'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import type { AssistantSessionRow } from '@/lib/types';
import {
  ApiError,
  createSessionPlanChangeRequest,
  getAssistantPricingPlans,
} from '@/lib/api';
import { formatDH } from '@/lib/format';
import {
  amountDiff,
  formatAmountDiff,
  formatPlanMinutes,
  currentPlanLabel,
  validatePlanChangeReason,
} from '@/lib/plan-change';

type AssistantPlanOption = {
  id: string;
  name: string;
  durationSeconds: number;
  priceAmount: number;
  currency: string;
  sortOrder: number;
};

interface Props {
  session: AssistantSessionRow;
  onClose: () => void;
  onSuccess: () => void;
}

export function AssistantPlanChangeRequestModal({ session, onClose, onSuccess }: Props) {
  const [plans, setPlans] = useState<AssistantPlanOption[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [requestedPlanId, setRequestedPlanId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);

  useEffect(() => {
    getAssistantPricingPlans()
      .then((r) => setPlans(r.items ?? []))
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

  async function handleSubmit() {
    const reasonMsg = validatePlanChangeReason(reason);
    setReasonError(reasonMsg);
    if (reasonMsg) return;
    if (!requestedPlanId) {
      setError('Veuillez sélectionner un nouveau plan.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createSessionPlanChangeRequest(session.id, {
        requestedPlanId,
        reason: reason.trim(),
      });
      setDone(true);
      window.setTimeout(() => {
        onSuccess();
        onClose();
      }, 700);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erreur lors de l’envoi.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-3 top-1/2 z-50 max-h-[90vh] -translate-y-1/2 overflow-y-auto rounded-2xl border border-stone-200 bg-white shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-bold text-stone-900">
            {!session.matchedPlanId && !session.matchedPlanName
              ? 'Demander l’attribution d’un plan'
              : 'Demander une modification du plan'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="rounded-xl bg-stone-50 px-3 py-2.5 text-sm">
            <p className="font-semibold text-stone-900">{session.chairName}</p>
            <p className="mt-1 text-xs text-stone-500">
              Plan actuel :{' '}
              <span className={!session.matchedPlanName ? 'font-semibold text-orange-700' : ''}>
                {currentPlanLabel(session.matchedPlanName)}
              </span>
            </p>
            <p className="text-xs text-stone-500">
              Montant actuel : {formatDH(currentExpected ?? 0)}
            </p>
            {!session.matchedPlanId && !session.matchedPlanName && (
              <p className="mt-1.5 text-[11px] text-orange-700">
                Aucun plan n’a été identifié (session arrêtée trop tôt). Vous pouvez en demander un.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              Nouveau plan
            </label>
            {loadingPlans ? (
              <p className="text-xs text-stone-400">Chargement des plans…</p>
            ) : (
              <select
                value={requestedPlanId}
                onChange={(e) => setRequestedPlanId(e.target.value)}
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-stone-500 focus:outline-none"
              >
                <option value="">Sélectionner un plan…</option>
                {selectable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatPlanMinutes(p.durationSeconds)} — {formatDH(p.priceAmount)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selected && (
            <div className="space-y-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-stone-700">
              <p>
                Nouvelle durée : <span className="font-semibold">{formatPlanMinutes(selected.durationSeconds)}</span>
              </p>
              <p>
                Nouveau montant attendu :{' '}
                <span className="font-semibold">{formatDH(selected.priceAmount)}</span>
              </p>
              <p>
                Différence :{' '}
                <span className={`font-semibold ${diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-red-700' : ''}`}>
                  {formatAmountDiff(diff)}
                </span>
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              Raison de la modification *
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(validatePlanChangeReason(e.target.value));
              }}
              rows={3}
              placeholder={
                !session.matchedPlanId && !session.matchedPlanName
                  ? 'Ex. : le client a utilisé le fauteuil brièvement, facturer le plan 20 min.'
                  : 'Ex. : le client a demandé dix minutes supplémentaires.'
              }
              className="w-full resize-none rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-stone-500 focus:outline-none"
            />
            {reasonError && <p className="mt-1 text-xs font-medium text-red-600">{reasonError}</p>}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {done && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <p className="text-xs text-emerald-800">Demande envoyée. En attente de validation.</p>
            </div>
          )}

          <p className="text-[11px] text-stone-400">
            La session ne sera pas modifiée tant que l’Owner n’a pas validé la demande.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-600 disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || done || loadingPlans}
            className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-40"
          >
            {saving ? 'Envoi…' : 'Envoyer la demande'}
          </button>
        </div>
      </div>
    </>
  );
}
