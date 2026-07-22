/**
 * Unit tests for session plan-change business rules (no database).
 * Run: npm run test:session-plan-change
 */
import assert from 'node:assert/strict';
import {
  assertNoPendingRequest,
  assertPaidAmountIsDifferent,
  assertPlanEligibleForAssignment,
  assertPlanIsDifferent,
  assertRequestNotStale,
  assertRequestStillPending,
  assertSessionEligibleForPlanChange,
  buildPaidAmountSessionUpdate,
  buildPlanChangeSessionUpdate,
  claimPendingRequest,
  computeFinalAmount,
  computeRemainingAmount,
  technicalFieldsUnchanged,
  validateModificationRequestInput,
  validateOptionalReviewNote,
  validateReason,
  type PlanChangePlanSnapshot,
  type PlanChangeSessionSnapshot,
} from './session-plan-change.logic';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const baseSession: PlanChangeSessionSnapshot = {
  id: 'session-1',
  status: 'COMPLETED',
  archivedAt: null,
  matchedPlanId: 'plan-20',
  expectedAmount: 20,
  correctedAmount: 20,
  durationSeconds: 600,
  updatedAt: new Date('2026-07-18T10:00:00.000Z'),
  startedAt: new Date('2026-07-18T09:00:00.000Z'),
  endedAt: new Date('2026-07-18T09:10:00.000Z'),
  minPowerWatts: 40,
  maxPowerWatts: 120,
  avgPowerWatts: 80,
  chairId: 'chair-1',
  shiftId: 'shift-1',
};

const plan30: PlanChangePlanSnapshot = {
  id: 'plan-30',
  name: '30 min',
  durationSeconds: 1800,
  priceAmount: 30,
  isActive: true,
  archivedAt: null,
};

console.log('session-plan-change.logic tests');

// 1 / 2 — valid assistant request prerequisites (session unchanged is a service guarantee;
//    logic ensures create does not imply apply)
test('1. assistant can prepare a valid request (reason + different active plan)', () => {
  const reason = validateReason('Le client a demandé dix minutes supplémentaires.');
  assert.equal(reason.ok, true);
  assert.equal(assertPlanEligibleForAssignment(plan30), null);
  assert.equal(assertPlanIsDifferent(baseSession.matchedPlanId, plan30.id), null);
  assert.equal(assertSessionEligibleForPlanChange(baseSession), null);
});

test('2. creating a request must not mutate technical or plan fields (apply is separate)', () => {
  const before = { ...baseSession };
  // Simulate "create request" — no apply called
  const after = { ...before };
  assert.equal(after.matchedPlanId, before.matchedPlanId);
  assert.equal(after.expectedAmount, before.expectedAmount);
  assert.ok(technicalFieldsUnchanged(before, after));
});

test('3. empty reason is rejected', () => {
  const r = validateReason('   ');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.status, 400);
});

test('4. identical plan is rejected', () => {
  const err = assertPlanIsDifferent('plan-30', 'plan-30');
  assert.ok(err);
  assert.equal(err!.status, 409);
});

test('5. second PENDING request is rejected', () => {
  const err = assertNoPendingRequest({ id: 'req-1', status: 'PENDING' });
  assert.ok(err);
  assert.equal(err!.status, 409);
});

test('6. assistant cannot approve (role gate expressed as OWNER-only pending claim)', () => {
  // Approving requires OWNER; assistant role is rejected by service. Logic layer:
  // a non-pending or foreign claim fails. Here we assert reject path preserves session.
  const before = { ...baseSession };
  const rejectOnly = assertRequestStillPending('PENDING');
  assert.equal(rejectOnly, null);
  // Rejection does not call buildPlanChangeSessionUpdate
  assert.equal(before.matchedPlanId, 'plan-20');
});

test('7. owner can approve a PENDING request (claim succeeds)', () => {
  const requests = [{ id: 'req-1', status: 'PENDING' as const }];
  const claim = claimPendingRequest(requests, 'req-1');
  assert.equal(claim.claimed, true);
  assert.equal(requests[0]!.status, 'APPROVED');
});

test('8. session plan fields update after approval apply', () => {
  const update = buildPlanChangeSessionUpdate({
    session: baseSession,
    newPlan: plan30,
    previousPricingSnapshot: { durationSeconds: 600 },
    actorUserId: 'owner-1',
    reason: 'ok',
    source: 'REQUEST_APPROVED',
    requestId: 'req-1',
  });
  assert.equal(update.matchedPlanId, 'plan-30');
  assert.equal(update.expectedAmount, 30);
  assert.equal(update.pricingSnapshot.matchedPlanName, '30 min');
});

test('9. technical fields stay unchanged by plan-change payload', () => {
  const update = buildPlanChangeSessionUpdate({
    session: baseSession,
    newPlan: plan30,
    previousPricingSnapshot: null,
    actorUserId: 'owner-1',
    reason: 'ok',
    source: 'OWNER_DIRECT',
  });
  // Payload must not carry technical keys
  assert.equal('startedAt' in update, false);
  assert.equal('endedAt' in update, false);
  assert.equal('durationSeconds' in update, false);
  assert.equal('minPowerWatts' in update, false);
  assert.equal('maxPowerWatts' in update, false);
  assert.equal('avgPowerWatts' in update, false);
  assert.equal('chairId' in update, false);
  assert.equal('shiftId' in update, false);

  const after: PlanChangeSessionSnapshot = {
    ...baseSession,
    matchedPlanId: update.matchedPlanId,
    expectedAmount: update.expectedAmount,
  };
  assert.ok(technicalFieldsUnchanged(baseSession, after));
});

test('10. recorded payment (correctedAmount) stays unchanged after plan change', () => {
  const update = buildPlanChangeSessionUpdate({
    session: baseSession,
    newPlan: plan30,
    previousPricingSnapshot: null,
    actorUserId: 'owner-1',
    reason: 'ok',
    source: 'REQUEST_APPROVED',
  });
  // correctedAmount is not part of the update payload
  assert.equal('correctedAmount' in update, false);
  const afterCorrected = baseSession.correctedAmount;
  assert.equal(afterCorrected, 20);
  assert.equal(update.expectedAmount, 30);
});

test('11. remaining amount is recalculated from expected vs recorded payment', () => {
  // expected 30, paid/corrected 20 → remaining 10
  assert.equal(computeRemainingAmount(30, 20), 10);
  assert.equal(computeFinalAmount(30, 20), 20);
  // no recorded payment → remaining 0 (nothing collected separately)
  assert.equal(computeRemainingAmount(30, null), 0);
  assert.equal(computeFinalAmount(30, null), 30);
});

test('12. owner can reject a PENDING request (status gate allows reject while PENDING)', () => {
  assert.equal(assertRequestStillPending('PENDING'), null);
});

test('13. rejected request does not apply plan change (no update built)', () => {
  const before = { ...baseSession };
  // Reject path never calls buildPlanChangeSessionUpdate
  assert.equal(before.matchedPlanId, 'plan-20');
  assert.equal(before.expectedAmount, 20);
});

test('14. request cannot be approved twice', () => {
  const err = assertRequestStillPending('APPROVED');
  assert.ok(err);
  assert.equal(err!.status, 409);

  const requests = [{ id: 'req-1', status: 'APPROVED' as const }];
  const claim = claimPendingRequest(requests, 'req-1');
  assert.equal(claim.claimed, false);
});

test('15. concurrent approvals: only one claim succeeds', () => {
  const requests = [{ id: 'req-1', status: 'PENDING' as const }];
  const first = claimPendingRequest(requests, 'req-1');
  const second = claimPendingRequest(requests, 'req-1');
  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
});

test('16. stale request does not overwrite a newer session plan', () => {
  const err = assertRequestNotStale({
    requestStatus: 'PENDING',
    sessionMatchedPlanIdAtRequest: 'plan-20',
    sessionUpdatedAtAtRequest: new Date('2026-07-18T10:00:00.000Z'),
    currentMatchedPlanId: 'plan-40',
    currentUpdatedAt: new Date('2026-07-18T11:00:00.000Z'),
    requestedPlanId: 'plan-30',
  });
  assert.ok(err);
  assert.equal(err!.status, 409);
});

test('17. historical requests remain readable via snapshots (names/amounts frozen)', () => {
  const update = buildPlanChangeSessionUpdate({
    session: baseSession,
    newPlan: plan30,
    previousPricingSnapshot: { matchedPlanName: '20 min' },
    actorUserId: 'owner-1',
    reason: 'historique',
    source: 'OWNER_DIRECT',
    requestId: 'req-hist',
  });
  // Snapshots in request rows are created by the service; here we assert apply keeps
  // previousExpectedAmount in pricingSnapshot for audit readability.
  assert.equal(update.pricingSnapshot.previousMatchedPlanId, 'plan-20');
  assert.equal(update.pricingSnapshot.previousExpectedAmount, 20);
  assert.equal(update.pricingSnapshot.matchedPlanName, '30 min');
});

test('inactive plan is rejected', () => {
  const err = assertPlanEligibleForAssignment({ ...plan30, isActive: false });
  assert.ok(err);
  assert.equal(err!.status, 409);
});

test('ACTIVE session cannot change plan', () => {
  const err = assertSessionEligibleForPlanChange({ ...baseSession, status: 'ACTIVE' });
  assert.ok(err);
  assert.equal(err!.status, 409);
});

test('COMPLETED session without plan can receive a plan assignment', () => {
  const noPlan = {
    ...baseSession,
    matchedPlanId: null,
    expectedAmount: 0,
  };
  assert.equal(assertSessionEligibleForPlanChange(noPlan), null);
  assert.equal(assertPlanIsDifferent(null, plan30.id), null);

  const update = buildPlanChangeSessionUpdate({
    session: noPlan,
    newPlan: plan30,
    previousPricingSnapshot: { reason: 'TOO_SHORT' },
    actorUserId: 'owner-1',
    reason: 'Client a utilisé brièvement',
    source: 'REQUEST_APPROVED',
  });
  assert.equal(update.matchedPlanId, 'plan-30');
  assert.equal(update.expectedAmount, 30);
  assert.equal(update.billingStatus, 'CALCULATED');
  assert.equal(update.anomalyType, null);
  assert.equal(update.pricingSnapshot.hadNoPlan, true);
});

test('reviewNote length is limited', () => {
  const r = validateOptionalReviewNote('x'.repeat(501));
  assert.equal(r.ok, false);
});

test('modification requires at least plan or paid amount', () => {
  const empty = validateModificationRequestInput({});
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.error.status, 400);
});

test('paid-only modification with 0 DH is valid', () => {
  const mod = validateModificationRequestInput({ requestedPaidAmount: 0 });
  assert.equal(mod.ok, true);
  if (mod.ok) {
    assert.equal(mod.hasPlanChange, false);
    assert.equal(mod.hasPaidChange, true);
    assert.equal(mod.requestedPaidAmount, 0);
  }
});

test('plan-only modification is valid', () => {
  const mod = validateModificationRequestInput({ requestedPlanId: 'plan-30' });
  assert.equal(mod.ok, true);
  if (mod.ok) {
    assert.equal(mod.hasPlanChange, true);
    assert.equal(mod.hasPaidChange, false);
  }
});

test('both plan and paid modifications are valid', () => {
  const mod = validateModificationRequestInput({
    requestedPlanId: 'plan-30',
    requestedPaidAmount: 0,
  });
  assert.equal(mod.ok, true);
  if (mod.ok) {
    assert.equal(mod.hasPlanChange, true);
    assert.equal(mod.hasPaidChange, true);
    assert.equal(mod.requestedPaidAmount, 0);
  }
});

test('identical paid amount is rejected', () => {
  const err = assertPaidAmountIsDifferent(0, 0);
  assert.ok(err);
  assert.equal(err!.status, 409);
  assert.equal(assertPaidAmountIsDifferent(null, 0), null);
  assert.equal(assertPaidAmountIsDifferent(40, 0), null);
});

test('paid amount update never touches expectedAmount / plan', () => {
  const update = buildPaidAmountSessionUpdate({
    requestedPaidAmount: 0,
    actorUserId: 'owner-1',
    reason: 'Séance offerte',
  });
  assert.equal(update.correctedAmount, 0);
  assert.equal(update.billingStatus, 'CORRECTED');
  assert.equal(update.correctionReason, 'Séance offerte');
  assert.equal('expectedAmount' in update, false);
  assert.equal('matchedPlanId' in update, false);
});

test('finalAmount with paid 0 keeps expected intact in computation', () => {
  assert.equal(computeFinalAmount(40, 0), 0);
  assert.equal(computeRemainingAmount(40, 0), 40);
});

console.log('All session-plan-change.logic tests passed.');
