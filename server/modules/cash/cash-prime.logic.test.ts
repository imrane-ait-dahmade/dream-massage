/**
 * Unit tests — shift prime deductions in physical cash ledger.
 * Run: npm run test:cash
 */
import assert from 'node:assert/strict';
import {
  MemoryCashLedger,
  netPrimeDeductedFromMovements,
  planShiftPrimeSync,
  round2,
  SESSION_REF_TYPE,
  SHIFT_PRIME_REF_TYPE,
  shouldAllowShiftPrimeDeduction,
} from './cash.logic';

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

const CUTOVER = new Date('2026-08-30T12:00:00Z');
const PRE_CUTOVER = new Date('2026-08-29T12:00:00Z');
const POST_CUTOVER = new Date('2026-08-31T12:00:00Z');

async function run() {
  console.log('cash prime deductions');

  await test('1. session +100, prime 20 → balance 80', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    await ledger.setInitialBalance('CASH_1', 0);
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'oumaima',
      sessionId: 'sess-1',
      previousTargetPaid: 0,
      targetPaid: 100,
      sessionFinancialAt: POST_CUTOVER,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.getBalance('CASH_1'), 80);
  });

  await test('2. replay sync prime → still 80', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    await ledger.setInitialBalance('CASH_1', 0);
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'oumaima',
      sessionId: 'sess-1',
      previousTargetPaid: 0,
      targetPaid: 100,
      sessionFinancialAt: POST_CUTOVER,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.getBalance('CASH_1'), 80);
    assert.equal(ledger.netPrimeForShift('shift-1'), 20);
  });

  await test('3. prime 20 → 30 → only -10', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 30,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.getBalance('CASH_1'), -30);
    assert.equal(ledger.netPrimeForShift('shift-1'), 30);
  });

  await test('4. prime 30 → 10 → +20 restitution', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 30,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 10,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.getBalance('CASH_1'), -10);
  });

  await test('5. session 100→150 (+50), prime 20→30 (-10) → net +40', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    await ledger.setInitialBalance('CASH_1', 0);
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'oumaima',
      sessionId: 'sess-1',
      previousTargetPaid: 0,
      targetPaid: 100,
      sessionFinancialAt: POST_CUTOVER,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.getBalance('CASH_1'), 80);
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'oumaima',
      sessionId: 'sess-1',
      previousTargetPaid: 100,
      targetPaid: 150,
      sessionFinancialAt: POST_CUTOVER,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 30,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.getBalance('CASH_1'), 120);
  });

  await test('6. target bonus 0 → 30 → -30 once, replay idempotent', async () => {
    const plan = planShiftPrimeSync({
      desiredPrime: 30,
      alreadyDeductedPrime: 0,
      allowFirstDeduction: true,
      hasPrimeLedgerHistory: false,
    });
    assert.deepEqual(plan, { type: 'PRIME_DEDUCTION', amount: -30 });
    const replay = planShiftPrimeSync({
      desiredPrime: 30,
      alreadyDeductedPrime: 30,
      allowFirstDeduction: true,
      hasPrimeLedgerHistory: true,
    });
    assert.equal(replay, null);
  });

  await test('7. manual bonus +20 → -20', () => {
    const plan = planShiftPrimeSync({
      desiredPrime: 20,
      alreadyDeductedPrime: 0,
      allowFirstDeduction: true,
      hasPrimeLedgerHistory: false,
    });
    assert.equal(plan?.amount, -20);
  });

  await test('8. manual bonus 20 → 30 → -10 only', () => {
    const plan = planShiftPrimeSync({
      desiredPrime: 30,
      alreadyDeductedPrime: 20,
      allowFirstDeduction: true,
      hasPrimeLedgerHistory: true,
    });
    assert.equal(plan?.amount, -10);
  });

  await test('9. manual bonus 30 → 0 → +30', () => {
    const plan = planShiftPrimeSync({
      desiredPrime: 0,
      alreadyDeductedPrime: 30,
      allowFirstDeduction: true,
      hasPrimeLedgerHistory: true,
    });
    assert.equal(plan?.amount, 30);
  });

  await test('10. shift before cutover, no session ledger → no prime deduction', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    const result = await ledger.syncShiftPrime({
      shiftId: 'old-shift',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: PRE_CUTOVER,
      hasSessionPaymentsInLedger: false,
    });
    assert.equal(result, null);
    assert.equal(ledger.getBalance('CASH_1'), 0);
  });

  await test('11. Oumaima CASH_1 / Zainab CASH_2 — primes on correct tills', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.assignStaffToCashAccount('CASH_2', 'zainab');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    ledger.setCashTrackingStartedAt('CASH_2', CUTOVER);
    await ledger.syncShiftPrime({
      shiftId: 'shift-o',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-z',
      staffMemberId: 'zainab',
      cashAccountId: 'CASH_2',
      desiredPrime: 15,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.getBalance('CASH_1'), -20);
    assert.equal(ledger.getBalance('CASH_2'), -15);
    assert.equal(ledger.cashAccountIdForShiftPrime('shift-o'), 'CASH_1');
    assert.equal(ledger.cashAccountIdForShiftPrime('shift-z'), 'CASH_2');
  });

  await test('12. reassignment after prime → sticky CASH_1 history', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    ledger.assignStaffToCashAccount('CASH_1', null);
    ledger.assignStaffToCashAccount('CASH_2', 'oumaima');
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_2',
      desiredPrime: 25,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.cashAccountIdForShiftPrime('shift-1'), 'CASH_1');
    assert.equal(ledger.getBalance('CASH_1'), -25);
    assert.equal(ledger.getBalance('CASH_2'), 0);
  });

  await test('13–14. store total net across two tills', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.assignStaffToCashAccount('CASH_2', 'zainab');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    ledger.setCashTrackingStartedAt('CASH_2', CUTOVER);
    await ledger.setInitialBalance('CASH_1', 180);
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'oumaima',
      sessionId: 'sess-1',
      previousTargetPaid: 0,
      targetPaid: 100,
      sessionFinancialAt: POST_CUTOVER,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.getBalance('CASH_1'), 260);
    assert.equal(ledger.storeTotal(), 260);
  });

  await test('15. concurrent replay → single net prime', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    await Promise.all([
      ledger.syncShiftPrime({
        shiftId: 'shift-1',
        staffMemberId: 'oumaima',
        cashAccountId: 'CASH_1',
        desiredPrime: 20,
        shiftStartedAt: POST_CUTOVER,
        hasSessionPaymentsInLedger: true,
      }),
      ledger.syncShiftPrime({
        shiftId: 'shift-1',
        staffMemberId: 'oumaima',
        cashAccountId: 'CASH_1',
        desiredPrime: 20,
        shiftStartedAt: POST_CUTOVER,
        hasSessionPaymentsInLedger: true,
      }),
    ]);
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(ledger.netPrimeForShift('shift-1'), 20);
    const primeMoves = ledger
      .listMovements({ cashAccountId: 'CASH_1' })
      .items.filter((m) => m.type === 'PRIME_DEDUCTION');
    assert.equal(primeMoves.length, 1);
  });

  await test('netPrimeDeductedFromMovements sign convention', () => {
    assert.equal(netPrimeDeductedFromMovements([-20]), 20);
    assert.equal(netPrimeDeductedFromMovements([-20, -10]), 30);
    assert.equal(netPrimeDeductedFromMovements([-20, 5]), 15);
  });

  await test('shouldAllowShiftPrimeDeduction cutover rules', () => {
    assert.equal(
      shouldAllowShiftPrimeDeduction({
        hasPrimeLedgerHistory: false,
        shiftStartedAt: PRE_CUTOVER,
        cashTrackingStartedAt: CUTOVER,
        hasSessionPaymentsInLedger: false,
      }),
      false,
    );
    assert.equal(
      shouldAllowShiftPrimeDeduction({
        hasPrimeLedgerHistory: false,
        shiftStartedAt: PRE_CUTOVER,
        cashTrackingStartedAt: CUTOVER,
        hasSessionPaymentsInLedger: true,
      }),
      true,
    );
  });

  await test('real example: initial 180 + session 100 - prime 20 = 260', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', CUTOVER);
    await ledger.setInitialBalance('CASH_1', 180);
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'oumaima',
      sessionId: 'sess-1',
      previousTargetPaid: 0,
      targetPaid: 100,
      sessionFinancialAt: POST_CUTOVER,
    });
    await ledger.syncShiftPrime({
      shiftId: 'shift-1',
      staffMemberId: 'oumaima',
      cashAccountId: 'CASH_1',
      desiredPrime: 20,
      shiftStartedAt: POST_CUTOVER,
      hasSessionPaymentsInLedger: true,
    });
    assert.equal(round2(ledger.getBalance('CASH_1')), 260);
  });

  console.log('\nAll cash prime tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
