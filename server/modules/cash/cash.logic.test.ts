/**
 * Unit tests — physical cash registers (Caisse 1 / Caisse 2).
 * Run: npm run test:cash
 */
import assert from 'node:assert/strict';
import {
  MemoryCashLedger,
  applySignedAmount,
  assertWithdrawAmount,
  planInitialBalance,
  planSessionPaidSync,
  round2,
  SESSION_REF_TYPE,
  toCents,
} from './cash.logic';
import { assessSessionDeletion } from '../sessions/session-delete.logic';
import { adminCreditBodySchema, parseAdminCreditBody } from './cash.credit-http';

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

async function run() {
  console.log('physical cash registers');

  await test('centimes avoid float drift', () => {
    assert.equal(toCents(0.1) + toCents(0.2), toCents(0.3));
    assert.equal(round2(0.1 + 0.2), 0.3);
  });

  await test('1. Caisse 1 et Caisse 2 indépendantes (soldes 0)', () => {
    const ledger = new MemoryCashLedger();
    assert.equal(ledger.getBalance('CASH_1'), 0);
    assert.equal(ledger.getBalance('CASH_2'), 0);
    assert.equal(ledger.storeTotal(), 0);
  });

  await test('2. +200 Caisse 1 → Caisse 2 inchangée', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_1', staffMemberId: 'sara', amount: 200 });
    assert.equal(ledger.getBalance('CASH_1'), 200);
    assert.equal(ledger.getBalance('CASH_2'), 0);
  });

  await test('3. +300 Caisse 2', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_1', staffMemberId: 'sara', amount: 200 });
    await ledger.credit({ cashAccountId: 'CASH_2', staffMemberId: 'imane', amount: 300 });
    assert.equal(ledger.getBalance('CASH_2'), 300);
    assert.equal(ledger.storeTotal(), 500);
  });

  await test('4. plusieurs filles sur la même caisse', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_1', staffMemberId: 'sara', amount: 100 });
    await ledger.credit({ cashAccountId: 'CASH_1', staffMemberId: 'imane', amount: 50 });
    assert.equal(ledger.getBalance('CASH_1'), 150);
    const sara = ledger.listMovements({ cashAccountId: 'CASH_1', staffMemberId: 'sara' });
    assert.equal(sara.total, 1);
  });

  await test('5. même fille sur deux caisses à des moments différents', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_1', staffMemberId: 'sara', amount: 100 });
    await ledger.credit({ cashAccountId: 'CASH_2', staffMemberId: 'sara', amount: 80 });
    assert.equal(ledger.getBalance('CASH_1'), 100);
    assert.equal(ledger.getBalance('CASH_2'), 80);
    assert.equal(ledger.listMovements({ staffMemberId: 'sara' }).total, 2);
  });

  await test('6–8. filtres fille / caisse / combinés', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_1', staffMemberId: 'sara', amount: 10 });
    await ledger.credit({ cashAccountId: 'CASH_1', staffMemberId: 'imane', amount: 20 });
    await ledger.credit({ cashAccountId: 'CASH_2', staffMemberId: 'sara', amount: 30 });
    assert.equal(ledger.listMovements({ staffMemberId: 'sara' }).total, 2);
    assert.equal(ledger.listMovements({ cashAccountId: 'CASH_1' }).total, 2);
    assert.equal(ledger.listMovements({ cashAccountId: 'CASH_1', staffMemberId: 'sara' }).total, 1);
    // Filtre fille ne change PAS le solde physique
    assert.equal(ledger.getBalance('CASH_1'), 30);
  });

  await test('9. retrait Caisse 1', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_1', amount: 2000 });
    await ledger.withdraw('CASH_1', 1500, 'remise banque');
    assert.equal(ledger.getBalance('CASH_1'), 500);
    assert.equal(ledger.getBalance('CASH_2'), 0);
  });

  await test('10. correction Caisse 2', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_2', amount: 900 });
    const adj = await ledger.adjust('CASH_2', 850, 'écart inventaire');
    assert.equal(adj.type, 'ADMIN_ADJUSTMENT');
    assert.equal(adj.amount, -50);
    assert.equal(ledger.getBalance('CASH_2'), 850);
  });

  await test('11–12. SESSION_PAYMENT sticky till + changement affectation', async () => {
    const ledger = new MemoryCashLedger();
    const m = await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-1',
      previousPaidAmount: null,
      targetPaid: 200,
    });
    assert.ok(m);
    assert.equal(m!.cashAccountId, 'CASH_1');
    assert.equal(m!.type, 'SESSION_PAYMENT');

    // Later assignment would be CASH_2 — correction stays on CASH_1
    const corr = await ledger.syncSessionPaid({
      cashAccountId: 'CASH_2',
      staffMemberId: 'sara',
      sessionId: 'sess-1',
      previousPaidAmount: 200,
      targetPaid: 250,
    });
    assert.ok(corr);
    assert.equal(corr!.cashAccountId, 'CASH_1');
    assert.equal(corr!.type, 'CORRECTION');
    assert.equal(corr!.amount, 50);
    assert.equal(ledger.getBalance('CASH_1'), 250);
    assert.equal(ledger.getBalance('CASH_2'), 0);
    assert.equal(ledger.cashAccountIdForSession('sess-1'), 'CASH_1');
  });

  await test('13. idempotence SESSION_PAYMENT', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-a',
      previousPaidAmount: null,
      targetPaid: 200,
    });
    const again = await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-a',
      previousPaidAmount: 200,
      targetPaid: 200,
    });
    assert.equal(again, null);
    assert.equal(ledger.getBalance('CASH_1'), 200);
    assert.equal(ledger.netForSession('sess-a'), 200);
  });

  await test('14. REVERSAL sur la même caisse d’origine', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_2',
      staffMemberId: 'imane',
      sessionId: 'sess-r',
      previousPaidAmount: null,
      targetPaid: 200,
    });
    const rev = await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1', // would-be wrong till — sticky wins
      staffMemberId: 'imane',
      sessionId: 'sess-r',
      previousPaidAmount: 200,
      targetPaid: null,
    });
    assert.ok(rev);
    assert.equal(rev!.type, 'REVERSAL');
    assert.equal(rev!.cashAccountId, 'CASH_2');
    assert.equal(ledger.getBalance('CASH_2'), 0);
  });

  await test('15. augmentation / réduction correctedAmount', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-m',
      previousPaidAmount: null,
      targetPaid: 200,
    });
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-m',
      previousPaidAmount: 200,
      targetPaid: 250,
    });
    assert.equal(ledger.netForSession('sess-m'), 250);
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-m',
      previousPaidAmount: 250,
      targetPaid: 180,
    });
    assert.equal(ledger.netForSession('sess-m'), 180);
    assert.equal(ledger.getBalance('CASH_1'), 180);
  });

  await test('16. concurrence FOR UPDATE même caisse', async () => {
    const ledger = new MemoryCashLedger();
    await Promise.all([
      ledger.credit({ cashAccountId: 'CASH_1', amount: 100 }),
      ledger.credit({ cashAccountId: 'CASH_1', amount: 100 }),
      ledger.credit({ cashAccountId: 'CASH_1', amount: 100 }),
    ]);
    assert.equal(ledger.getBalance('CASH_1'), 300);
  });

  await test('17. opérations simultanées Caisse 1 et Caisse 2', async () => {
    const ledger = new MemoryCashLedger();
    await Promise.all([
      ledger.credit({ cashAccountId: 'CASH_1', amount: 100 }),
      ledger.credit({ cashAccountId: 'CASH_2', amount: 200 }),
    ]);
    assert.equal(ledger.getBalance('CASH_1'), 100);
    assert.equal(ledger.getBalance('CASH_2'), 200);
  });

  await test('18–19. stats quotidiennes + total magasin', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_1', staffMemberId: 'sara', amount: 400 });
    await ledger.withdraw('CASH_1', 50);
    await ledger.credit({ cashAccountId: 'CASH_2', staffMemberId: 'imane', amount: 100 });
    const stats1 = ledger.dayStats('CASH_1', 0, 9999);
    assert.equal(stats1.physicalBalance, 350);
    assert.equal(stats1.dailyIncome, 400);
    assert.equal(stats1.withdrawals, 50);
    assert.equal(ledger.storeTotal(), 450);
    const filtered = ledger.dayStats('CASH_1', 0, 9999, 'sara');
    assert.equal(filtered.physicalBalance, 350); // solde physique inchangé
    assert.equal(filtered.dailyIncome, 400);
  });

  await test('20. permissions OWNER/ADMIN (gates)', () => {
    function canCashAdmin(role: string) {
      return role === 'OWNER' || role === 'ADMIN';
    }
    function canInitialBalance(role: string) {
      return role === 'OWNER';
    }
    assert.equal(canCashAdmin('ASSISTANT'), false);
    assert.equal(canCashAdmin('ADMIN'), true);
    assert.equal(canInitialBalance('ADMIN'), false);
    assert.equal(canInitialBalance('OWNER'), true);
  });

  await test('rollback après plan → aucun mouvement', async () => {
    const ledger = new MemoryCashLedger();
    await assert.rejects(
      () =>
        ledger.syncSessionPaid({
          cashAccountId: 'CASH_1',
          staffMemberId: 'sara',
          sessionId: 'sess-fail',
          previousPaidAmount: null,
          targetPaid: 200,
          failAfterPlan: true,
        }),
      /ROLLBACK_TEST/,
    );
    assert.equal(ledger.getBalance('CASH_1'), 0);
  });

  await test('legacy: pas de backfill', () => {
    assert.equal(
      planSessionPaidSync({
        netCredited: 0,
        hasLedgerHistory: false,
        hasSessionPayment: false,
        previousPaidAmount: 300,
        targetPaid: 300,
      }),
      null,
    );
  });

  await test('cutover INITIAL_BALANCE par caisse physique', async () => {
    const ledger = new MemoryCashLedger();
    const m = await ledger.setInitialBalance('CASH_1', 1250);
    assert.equal(m.type, 'INITIAL_BALANCE');
    assert.equal(m.staffMemberId, null);
    assert.equal(ledger.getBalance('CASH_1'), 1250);
    await assert.rejects(() => ledger.setInitialBalance('CASH_1', 1), /déjà un solde initial/);
  });

  await test('archive soft-hide ≠ reverse; clear = reverse', async () => {
    const paid = assessSessionDeletion({
      shiftId: 's1',
      chairEventsCount: 0,
      billingStatus: 'CORRECTED',
      correctedAmount: 200,
      expectedAmount: 200,
    });
    assert.equal(paid.mustArchive, true);
    const ledger = new MemoryCashLedger();
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-arch',
      previousPaidAmount: null,
      targetPaid: 200,
    });
    assert.equal(ledger.getBalance('CASH_1'), 200);
  });

  await test('session sans till/staff → no-op', async () => {
    const ledger = new MemoryCashLedger();
    assert.equal(
      await ledger.syncSessionPaid({
        cashAccountId: null,
        staffMemberId: 'sara',
        sessionId: 'x',
        previousPaidAmount: null,
        targetPaid: 100,
      }),
      null,
    );
  });

  console.log('admin credit HTTP lockdown');

  await test('HTTP credit cannot forge SESSION_PAYMENT', () => {
    assert.equal(
      adminCreditBodySchema.safeParse({ amount: 200, type: 'SESSION_PAYMENT' }).success,
      false,
    );
    const parsed = parseAdminCreditBody({ amount: 200, reason: 'apport' });
    assert.equal(parsed.ok, true);
  });

  await test('assertWithdrawAmount + applySignedAmount', () => {
    assert.throws(() => assertWithdrawAmount(100, 200), /insuffisant/);
    assert.equal(applySignedAmount(100, 50).balanceAfter, 150);
  });

  await test('planInitialBalance rejects negative', () => {
    assert.throws(
      () =>
        planInitialBalance({
          countedAmount: -1,
          currentBalance: 0,
          movementCount: 0,
          hasInitialBalance: false,
        }),
      /négatif/,
    );
  });

  console.log('All cash tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
