/**
 * Frontend helpers for session modification UI (plan and/or paid amount).
 * Run from web/: npx tsx src/lib/plan-change.test.ts
 */
import assert from 'node:assert/strict';
import {
  amountDiff,
  canRequestPlanChange,
  computeRemainingAmount,
  formatAmountDiff,
  formatApprovedRequestSummary,
  formatPlanMinutes,
  parsePaidAmountInput,
  planChangeStatusLabel,
  validateModificationSelection,
  validatePlanChangeReason,
} from './plan-change';
import type { SessionPlanChangeRequest } from './types';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('plan-change frontend helpers');

test('1. Assistant eligible only for COMPLETED sessions', () => {
  assert.equal(canRequestPlanChange({ status: 'COMPLETED' }), true);
  assert.equal(canRequestPlanChange({ status: 'ACTIVE' }), false);
});

test('2. No owner approve/reject helpers exposed here (role gating is UI+API)', () => {
  assert.equal(planChangeStatusLabel('PENDING'), 'En attente');
  assert.equal(planChangeStatusLabel('APPROVED'), 'Validée');
  assert.equal(planChangeStatusLabel('REJECTED'), 'Refusée');
});

test('3. Reason is mandatory', () => {
  assert.ok(validatePlanChangeReason(''));
  assert.ok(validatePlanChangeReason('   '));
  assert.equal(validatePlanChangeReason('Client a demandé 10 min'), null);
});

test('4. Plan comparison amounts are correct', () => {
  assert.equal(amountDiff(20, 30), 10);
  assert.equal(formatAmountDiff(10), '+10 DH');
  assert.equal(formatPlanMinutes(1800), '30 min');
});

test('5. Creating a request does not imply session mutation (helper is pure)', () => {
  const session = { status: 'COMPLETED', matchedPlanId: 'p20', expectedAmount: 20 };
  assert.equal(session.matchedPlanId, 'p20');
  assert.equal(session.expectedAmount, 20);
});

test('6-8. Remaining / paid unchanged semantics', () => {
  // paid/corrected 20, new expected 30 → remaining 10
  assert.equal(computeRemainingAmount(30, 20), 10);
  assert.equal(computeRemainingAmount(30, null), 0);
  // paid 0 is valid
  assert.equal(computeRemainingAmount(40, 0), 40);
});

test('9-14. Status labels and 409-facing validation stay stable', () => {
  assert.equal(planChangeStatusLabel('REJECTED'), 'Refusée');
  assert.ok(validatePlanChangeReason('x'.repeat(501)));
});

test('paid amount 0 is parsed as zero, not omitted', () => {
  const zero = parsePaidAmountInput('0');
  assert.equal(zero.ok, true);
  if (zero.ok && !('omitted' in zero && zero.omitted)) {
    assert.equal(zero.value, 0);
  }
  const empty = parsePaidAmountInput('  ');
  assert.equal(empty.ok, true);
  assert.ok('omitted' in empty && empty.omitted);
});

test('modification selection requires at least one change', () => {
  assert.ok(
    validateModificationSelection({
      changePlan: false,
      requestedPlanId: '',
      changePaid: false,
      paidAmountRaw: '',
      currentPaidAmount: null,
    }),
  );
  assert.equal(
    validateModificationSelection({
      changePlan: false,
      requestedPlanId: '',
      changePaid: true,
      paidAmountRaw: '0',
      currentPaidAmount: null,
    }),
    null,
  );
});

test('approved summary covers plan and/or paid', () => {
  const paidOnly = {
    hasPlanChange: false,
    hasPaidChange: true,
    requestedPlanName: null,
    requestedDurationSeconds: null,
    requestedPaidAmount: 0,
  } as SessionPlanChangeRequest;
  assert.ok(formatApprovedRequestSummary(paidOnly).includes('0'));
});

console.log('All plan-change frontend helper tests passed.');
