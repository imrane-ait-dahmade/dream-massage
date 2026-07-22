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
  parsePaidAmountInput,
  validateModificationSelection,
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
  const [changePlan, setChangePlan] = useState(false);
  const [changePaid, setChangePaid] = useState(false);
  const [requestedPlanId, setRequestedPlanId] = useState('');
  const [paidAmountRaw, setPaidAmountRaw] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);

  const currentPaid = session.correctedAmount;
  const currentExpected = session.expectedAmount;

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
  const newExpected = selected?.priceAmount ?? null;
  const expectedDiff = amountDiff(currentExpected, newExpected);

  const paidPreview = (() => {
    if (!changePaid) return null;
    const parsed = parsePaidAmountInput(paidAmountRaw);
    if (!parsed.ok || ('omitted' in parsed && parsed.omitted)) return null;
    return parsed.value;
  })();

  async function handleSubmit() {
    const reasonMsg = validatePlanChangeReason(reason);
    setReasonError(reasonMsg);
    if (reasonMsg) return;

    const selectionMsg = validateModificationSelection({
      changePlan,
      requestedPlanId,
      changePaid,
      paidAmountRaw,
      currentPaidAmount: currentPaid,
    });
    if (selectionMsg) {
      setError(selectionMsg);
      return;
    }

    const payload: {
      requestedPlanId?: string;
      requestedPaidAmount?: number;
      reason: string;
    } = { reason: reason.trim() };

    if (changePlan) {
      payload.requestedPlanId = requestedPlanId;
    }
    if (changePaid) {
      const parsed = parsePaidAmountInput(paidAmountRaw);
      if (!parsed.ok || ('omitted' in parsed && parsed.omitted) || parsed.value == null) {
        setError('Indiquez le nouveau montant payé (0 DH autorisé).');
        return;
      }
      payload.requestedPaidAmount = parsed.value;
    }

    setSaving(true);
    setError(null);
    try {
      await createSessionPlanChangeRequest(session.id, payload);
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
          <h2 className="text-sm font-bold text-stone-900">Demander une modification</h2>
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
              Plan :{' '}
              <span className={!session.matchedPlanName ? 'font-semibold text-orange-700' : ''}>
                {currentPlanLabel(session.matchedPlanName)}
              </span>
            </p>
            <p className="text-xs text-stone-500">
              Prix attendu : {formatDH(currentExpected ?? 0)}
            </p>
            <p className="text-xs text-stone-500">
              Montant payé :{' '}
              {currentPaid != null ? formatDH(currentPaid) : 'Non renseigné'}
            </p>
            {!session.matchedPlanId && !session.matchedPlanName && (
              <p className="mt-1.5 text-[11px] text-orange-700">
                Aucun plan n’a été identifié (session arrêtée trop tôt). Vous pouvez en demander un.
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-stone-200 px-3 py-2.5">
            <input
              type="checkbox"
              checked={changePlan}
              onChange={(e) => {
                setChangePlan(e.target.checked);
                if (!e.target.checked) setRequestedPlanId('');
                setError(null);
              }}
              className="mt-0.5"
            />
            <span className="text-sm text-stone-800">
              <span className="font-semibold">Modifier le plan</span>
              <span className="mt-0.5 block text-xs text-stone-500">
                Met à jour le prix attendu selon le plan choisi. Ne change pas le montant payé.
              </span>
            </span>
          </label>

          {changePlan && (
            <div className="space-y-2 pl-1">
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
              {selected && (
                <div className="space-y-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-stone-700">
                  <p>
                    Nouveau prix attendu :{' '}
                    <span className="font-semibold">{formatDH(selected.priceAmount)}</span>
                  </p>
                  <p>
                    Différence prix attendu :{' '}
                    <span
                      className={`font-semibold ${
                        expectedDiff > 0
                          ? 'text-emerald-700'
                          : expectedDiff < 0
                            ? 'text-red-700'
                            : ''
                      }`}
                    >
                      {formatAmountDiff(expectedDiff)}
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 rounded-xl border border-stone-200 px-3 py-2.5">
            <input
              type="checkbox"
              checked={changePaid}
              onChange={(e) => {
                setChangePaid(e.target.checked);
                if (!e.target.checked) setPaidAmountRaw('');
                setError(null);
              }}
              className="mt-0.5"
            />
            <span className="text-sm text-stone-800">
              <span className="font-semibold">Modifier le montant payé</span>
              <span className="mt-0.5 block text-xs text-stone-500">
                Montant réellement encaissé. 0 DH est autorisé (ex. séance offerte).
              </span>
            </span>
          </label>

          {changePaid && (
            <div className="space-y-2 pl-1">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Nouveau montant payé (DH)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={paidAmountRaw}
                onChange={(e) => {
                  setPaidAmountRaw(e.target.value);
                  setError(null);
                }}
                placeholder="Ex. : 0"
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-stone-500 focus:outline-none"
              />
              {paidPreview != null && (
                <p className="text-xs text-stone-600">
                  Aperçu : {formatDH(paidPreview)}
                  {currentPaid != null && (
                    <>
                      {' '}
                      ({formatAmountDiff(amountDiff(currentPaid, paidPreview))})
                    </>
                  )}
                </p>
              )}
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
                changePaid && !changePlan
                  ? 'Ex. : Séance offerte.'
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
            disabled={saving || done || (changePlan && loadingPlans)}
            className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-40"
          >
            {saving ? 'Envoi…' : 'Envoyer la demande'}
          </button>
        </div>
      </div>
    </>
  );
}
