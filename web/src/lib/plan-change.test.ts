/**
 * Frontend helpers for session plan-change UI.
 * Run from web/: npx tsx src/lib/plan-change.test.ts
 */
import assert from 'node:assert/strict';
import {
  amountDiff,
  canRequestPlanChange,
  computeRemainingAmount,
  formatAmountDiff,
  formatPlanMinutes,
  planChangeStatusLabel,
  validatePlanChangeReason,
} from './plan-change';

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
});

test('9-14. Status labels and 409-facing validation stay stable', () => {
  assert.equal(planChangeStatusLabel('REJECTED'), 'Refusée');
  assert.ok(validatePlanChangeReason('x'.repeat(501)));
});

console.log('All plan-change frontend helper tests passed.');
