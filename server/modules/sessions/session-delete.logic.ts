/**
 * Pure rules for session delete vs archive (no database).
 * Run: npm run test:session-delete
 */

export type SessionDeleteInput = {
  shiftId: string | null;
  chairEventsCount: number;
  billingStatus: string;
  correctedAmount: number | null;
  expectedAmount: number | null;
  planChangeRequestsCount?: number;
};

export type SessionDeleteAssessment = {
  mustArchive: boolean;
  reasons: string[];
};

export function assessSessionDeletion(input: SessionDeleteInput): SessionDeleteAssessment {
  const reasons: string[] = [];

  if (input.shiftId) {
    reasons.push('linked shift (bonuses, commission, reports)');
  }
  if (input.chairEventsCount > 0) {
    reasons.push('chair events');
  }
  if (input.correctedAmount != null || input.billingStatus === 'CORRECTED') {
    reasons.push('price correction');
  }
  if (input.billingStatus === 'DISPUTED') {
    reasons.push('disputed billing');
  }
  if (
    input.expectedAmount != null &&
    (input.billingStatus === 'CALCULATED' || input.billingStatus === 'CORRECTED')
  ) {
    reasons.push('billing calculation');
  }
  if ((input.planChangeRequestsCount ?? 0) > 0) {
    reasons.push('plan change request history');
  }

  return {
    mustArchive: reasons.length > 0,
    reasons,
  };
}
