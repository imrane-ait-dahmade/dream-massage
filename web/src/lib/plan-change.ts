import type { PricingPlan, SessionPlanChangeRequestStatus } from './types';

/** Remaining amount: max(0, expected - recordedPaid). No payment model → correctedAmount acts as recorded when set. */
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
  return session.status === 'COMPLETED';
}

export function validatePlanChangeReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return 'La raison de la modification est obligatoire.';
  if (trimmed.length > 500) return 'La raison ne peut pas dépasser 500 caractères.';
  return null;
}

export function findPlan(plans: PricingPlan[], planId: string | null | undefined): PricingPlan | null {
  if (!planId) return null;
  return plans.find((p) => p.id === planId) ?? null;
}
