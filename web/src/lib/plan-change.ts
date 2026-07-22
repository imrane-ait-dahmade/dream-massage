import type { PricingPlan, SessionPlanChangeRequest, SessionPlanChangeRequestStatus } from './types';

/** Remaining amount: max(0, expected - paid). paid is correctedAmount when set. */
export function computeRemainingAmount(
  expectedAmount: number | null | undefined,
  correctedAmount: number | null | undefined,
): number {
  const expected = expectedAmount ?? 0;
  if (correctedAmount == null) return 0;
  return Math.max(0, expected - correctedAmount);
}

export function amountDiff(
  from: number | null | undefined,
  to: number | null | undefined,
): number {
  return (to ?? 0) - (from ?? 0);
}

export function formatAmountDiff(diff: number): string {
  const sign = diff > 0 ? '+' : '';
  return `${sign}${Math.round(diff).toLocaleString('fr-FR')} DH`;
}

export function formatPlanMinutes(durationSeconds: number | null | undefined): string {
  if (durationSeconds == null) return '—';
  const m = Math.round(durationSeconds / 60);
  return `${m} min`;
}

export function planChangeStatusLabel(status: SessionPlanChangeRequestStatus): string {
  switch (status) {
    case 'PENDING':
      return 'En attente';
    case 'APPROVED':
      return 'Validée';
    case 'REJECTED':
      return 'Refusée';
    default:
      return status;
  }
}

export function planChangeStatusClass(status: SessionPlanChangeRequestStatus): string {
  switch (status) {
    case 'PENDING':
      return 'bg-amber-100 text-amber-800 ring-amber-200';
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-800 ring-emerald-200';
    case 'REJECTED':
      return 'bg-red-100 text-red-800 ring-red-200';
    default:
      return 'bg-stone-100 text-stone-700';
  }
}

export function canRequestPlanChange(session: {
  status?: string | null;
  matchedPlanId?: string | null;
}): boolean {
  // COMPLETED sessions may have no matched plan (stopped before a plan was identified).
  return session.status === 'COMPLETED';
}

export function currentPlanLabel(planName: string | null | undefined): string {
  return planName?.trim() ? planName : 'Aucun plan';
}

export function validatePlanChangeReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return 'La raison de la modification est obligatoire.';
  if (trimmed.length > 500) return 'La raison ne peut pas dépasser 500 caractères.';
  return null;
}

/**
 * Parse a paid-amount input. Empty string = not provided.
 * "0" / "0.0" = 0 (valid). Never treat 0 as missing via truthiness.
 */
export function parsePaidAmountInput(
  raw: string,
): { ok: true; value: number } | { ok: false; error: string } | { ok: true; value: null; omitted: true } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null, omitted: true };
  const normalized = trimmed.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    return { ok: false, error: 'Le montant payé doit être un nombre valide.' };
  }
  if (n < 0) {
    return { ok: false, error: 'Le montant payé doit être >= 0.' };
  }
  return { ok: true, value: n };
}

export function validateModificationSelection(input: {
  changePlan: boolean;
  requestedPlanId: string;
  changePaid: boolean;
  paidAmountRaw: string;
  currentPaidAmount: number | null;
}): string | null {
  if (!input.changePlan && !input.changePaid) {
    return 'Sélectionnez au moins une modification : plan et/ou montant payé.';
  }
  if (input.changePlan && !input.requestedPlanId) {
    return 'Veuillez sélectionner un nouveau plan.';
  }
  if (input.changePaid) {
    const parsed = parsePaidAmountInput(input.paidAmountRaw);
    if (!parsed.ok) return parsed.error;
    if ('omitted' in parsed && parsed.omitted) {
      return 'Indiquez le nouveau montant payé (0 DH autorisé).';
    }
    if (parsed.value === input.currentPaidAmount) {
      return 'Le montant payé demandé est identique au montant payé actuel.';
    }
  }
  return null;
}

export function requestHasPlanChange(request: SessionPlanChangeRequest): boolean {
  if (typeof request.hasPlanChange === 'boolean') return request.hasPlanChange;
  return request.requestedPlanId != null;
}

export function requestHasPaidChange(request: SessionPlanChangeRequest): boolean {
  if (typeof request.hasPaidChange === 'boolean') return request.hasPaidChange;
  return request.requestedPaidAmount != null;
}

export function formatApprovedRequestSummary(request: SessionPlanChangeRequest): string {
  const parts: string[] = [];
  if (requestHasPlanChange(request)) {
    parts.push(
      `plan ${request.requestedPlanName ?? '—'} (${formatPlanMinutes(request.requestedDurationSeconds)})`,
    );
  }
  if (requestHasPaidChange(request)) {
    const paid = request.requestedPaidAmount;
    parts.push(
      `montant payé ${paid != null ? `${Math.round(paid).toLocaleString('fr-FR')} DH` : '—'}`,
    );
  }
  if (parts.length === 0) return 'modification validée';
  return parts.join(' · ');
}

export function findPlan(plans: PricingPlan[], planId: string | null | undefined): PricingPlan | null {
  if (!planId) return null;
  return plans.find((p) => p.id === planId) ?? null;
}
