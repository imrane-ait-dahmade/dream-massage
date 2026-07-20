/**
 * Unit tests for session delete vs archive rules.
 * Run: npm run test:session-delete
 */
import assert from 'node:assert/strict';
import { assessSessionDeletion } from './session-delete.logic';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('session-delete.logic tests');

test('orphan session without dependencies can be hard deleted', () => {
  const r = assessSessionDeletion({
    shiftId: null,
    chairEventsCount: 0,
    billingStatus: 'PENDING',
    correctedAmount: null,
    expectedAmount: null,
  });
  assert.equal(r.mustArchive, false);
  assert.equal(r.reasons.length, 0);
});

test('session linked to shift must be archived', () => {
  const r = assessSessionDeletion({
    shiftId: 'shift-1',
    chairEventsCount: 0,
    billingStatus: 'PENDING',
    correctedAmount: null,
    expectedAmount: null,
  });
  assert.equal(r.mustArchive, true);
  assert.ok(r.reasons.some((x) => x.includes('shift')));
});

test('session with chair events must be archived', () => {
  const r = assessSessionDeletion({
    shiftId: null,
    chairEventsCount: 2,
    billingStatus: 'PENDING',
    correctedAmount: null,
    expectedAmount: null,
  });
  assert.equal(r.mustArchive, true);
});

test('corrected session must be archived', () => {
  const r = assessSessionDeletion({
    shiftId: null,
    chairEventsCount: 0,
    billingStatus: 'CORRECTED',
    correctedAmount: 30,
    expectedAmount: 20,
  });
  assert.equal(r.mustArchive, true);
});

test('calculated billing with amount must be archived', () => {
  const r = assessSessionDeletion({
    shiftId: null,
    chairEventsCount: 0,
    billingStatus: 'CALCULATED',
    correctedAmount: null,
    expectedAmount: 20,
  });
  assert.equal(r.mustArchive, true);
});

test('session with plan-change request history must be archived', () => {
  const r = assessSessionDeletion({
    shiftId: null,
    chairEventsCount: 0,
    billingStatus: 'PENDING',
    correctedAmount: null,
    expectedAmount: null,
    planChangeRequestsCount: 1,
  });
  assert.equal(r.mustArchive, true);
  assert.ok(r.reasons.some((x) => x.includes('plan change')));
});

console.log('All session-delete.logic tests passed.');
