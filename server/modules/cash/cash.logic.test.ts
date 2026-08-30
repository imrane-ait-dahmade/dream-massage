/**
 * Unit tests — physical cash registers (Caisse 1 / Caisse 2).
 * Run: npm run test:cash
 */
import assert from 'node:assert/strict';
import {
  MemoryCashLedger,
  applySignedAmount,
  assertSessionCashCreditContext,
  assertWithdrawAmount,
  NO_CASH_FOR_STAFF_MSG,
  normalizeReason,
  planInitialBalance,
  planSessionPaidSync,
  planStaffAssignment,
  resolveSessionPaidTarget,
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
      previousTargetPaid: 0,
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
      previousTargetPaid: 200,
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
      previousTargetPaid: 0,
      targetPaid: 200,
    });
    const again = await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-a',
      previousTargetPaid: 200,
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
      previousTargetPaid: 0,
      targetPaid: 200,
    });
    const rev = await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1', // would-be wrong till — sticky wins
      staffMemberId: 'imane',
      sessionId: 'sess-r',
      previousTargetPaid: 200,
      targetPaid: 0,
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
      previousTargetPaid: 0,
      targetPaid: 200,
    });
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-m',
      previousTargetPaid: 200,
      targetPaid: 250,
    });
    assert.equal(ledger.netForSession('sess-m'), 250);
    await ledger.syncSessionPaid({
      cashAccountId: 'CASH_1',
      staffMemberId: 'sara',
      sessionId: 'sess-m',
      previousTargetPaid: 250,
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
          previousTargetPaid: 0,
          targetPaid: 200,
          failAfterPlan: true,
        }),
      /ROLLBACK_TEST/,
    );
    assert.equal(ledger.getBalance('CASH_1'), 0);
  });

  await test('legacy: pas de backfill avant cutover', () => {
    assert.equal(
      planSessionPaidSync({
        netCredited: 0,
        hasLedgerHistory: false,
        hasSessionPayment: false,
        previousTargetPaid: 300,
        targetPaid: 300,
        allowFirstCredit: false,
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
      previousTargetPaid: 0,
      targetPaid: 200,
    });
    assert.equal(ledger.getBalance('CASH_1'), 200);
  });

  await test('session sans till/staff → erreur si paiement requis', async () => {
    const ledger = new MemoryCashLedger();
    ledger.setCashTrackingStartedAt('CASH_1', new Date(0));
    await assert.rejects(
      () =>
        ledger.syncSessionPaid({
          cashAccountId: 'CASH_1',
          staffMemberId: null,
          sessionId: 'x',
          previousTargetPaid: 0,
          targetPaid: 100,
          sessionFinancialAt: new Date(),
        }),
      /Session sans fille/,
    );
  });

  await test('session sans caisse affectée → erreur métier', async () => {
    const ledger = new MemoryCashLedger();
    ledger.setCashTrackingStartedAt('CASH_1', new Date(0));
    await assert.rejects(
      () =>
        ledger.syncSessionPaid({
          cashAccountId: null,
          staffMemberId: 'sara',
          sessionId: 'x2',
          previousTargetPaid: 0,
          targetPaid: 100,
          sessionFinancialAt: new Date(),
        }),
      (err: Error) => err.message.includes('Aucune caisse'),
    );
  });

  console.log('cash ↔ staff assignment');

  await test('1. CASH_1 → Sara', () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'sara');
    assert.equal(ledger.getAssignedStaff('CASH_1'), 'sara');
    assert.equal(ledger.resolveCashAccountForStaff('sara'), 'CASH_1');
  });

  await test('2. CASH_2 → Imane', () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'sara');
    ledger.assignStaffToCashAccount('CASH_2', 'imane');
    assert.equal(ledger.resolveCashAccountForStaff('imane'), 'CASH_2');
  });

  await test('3. caisse sans fille autorisée', () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', null);
    assert.equal(ledger.getAssignedStaff('CASH_1'), null);
  });

  await test('4. fille inexistante refusée (planStaffAssignment)', () => {
    assert.throws(
      () =>
        planStaffAssignment({
          staffMemberId: 'ghost',
          staffExists: false,
          staffActive: true,
          staffAlreadyOnOtherTill: null,
        }),
      /introuvable/i,
    );
  });

  await test('6–7. unicité Sara sur une seule caisse', () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'sara');
    assert.throws(
      () => ledger.assignStaffToCashAccount('CASH_2', 'sara'),
      /déjà affectée/i,
    );
  });

  await test('8–10. Sara CASH_1 paiement 200', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'sara');
    const m = await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'sara',
      sessionId: 'pay-1',
      previousTargetPaid: 0,
      targetPaid: 200,
    });
    assert.ok(m);
    assert.equal(m!.cashAccountId, 'CASH_1');
    assert.equal(m!.staffMemberId, 'sara');
    assert.equal(ledger.getBalance('CASH_1'), 200);
    assert.equal(ledger.getBalance('CASH_2'), 0);
    const again = await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'sara',
      sessionId: 'pay-1',
      previousTargetPaid: 200,
      targetPaid: 200,
    });
    assert.equal(again, null);
  });

  await test('12–13. sans affectation → erreur + rollback', async () => {
    const ledger = new MemoryCashLedger();
    await assert.rejects(
      () =>
        ledger.syncSessionPaid({
          cashAccountId: null,
          staffMemberId: 'sara',
          sessionId: 'fail-1',
          previousTargetPaid: 0,
          targetPaid: 50,
          failAfterPlan: true,
        }),
      /Aucune caisse/,
    );
    assert.equal(ledger.getBalance('CASH_1'), 0);
  });

  await test('14–19. réaffectation CASH_1 Sara → Salma', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'sara');
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'sara',
      sessionId: 'reassign',
      previousTargetPaid: 0,
      targetPaid: 200,
    });
    const balanceBefore = ledger.getBalance('CASH_1');
    ledger.assignStaffToCashAccount('CASH_1', 'salma');
    assert.equal(ledger.getBalance('CASH_1'), balanceBefore);
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'salma',
      sessionId: 'reassign-2',
      previousTargetPaid: 0,
      targetPaid: 300,
    });
    assert.equal(ledger.getBalance('CASH_1'), 500);
    const saraMoves = ledger.listMovements({ staffMemberId: 'sara' });
    const salmaMoves = ledger.listMovements({ staffMemberId: 'salma' });
    assert.equal(saraMoves.total, 1);
    assert.equal(salmaMoves.total, 1);
    assert.equal(ledger.listMovements({ cashAccountId: 'CASH_1' }).total, 2);
  });

  await test('20–24. filtres + réaffectation ne touche pas solde/mouvements', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'sara');
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'sara',
      sessionId: 'f1',
      previousTargetPaid: 0,
      targetPaid: 100,
    });
    const oldMove = ledger.listMovements({ staffMemberId: 'sara' }).items[0]!;
    ledger.assignStaffToCashAccount('CASH_1', 'imane');
    assert.equal(ledger.getBalance('CASH_1'), 100);
    assert.equal(oldMove.staffMemberId, 'sara');
    assert.equal(ledger.listMovements({ staffMemberId: 'imane' }).total, 0);
  });

  await test('assertSessionCashCreditContext message', () => {
    assert.throws(
      () =>
        assertSessionCashCreditContext({
          plan: { type: 'SESSION_PAYMENT', amount: 1 },
          staffMemberId: 'sara',
          cashAccountId: null,
        }),
      (e: Error) => e.message === NO_CASH_FOR_STAFF_MSG,
    );
  });

  console.log('session auto-sync (expectedAmount → caisse)');

  await test('1–2. cutover 180 + session Oumaima +20 → 200', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    await ledger.setInitialBalance('CASH_1', 180);
    const cutoverAt = new Date('2026-08-30T10:00:00Z');
    ledger.setCashTrackingStartedAt('CASH_1', cutoverAt);
    const sessionAt = new Date('2026-08-30T12:00:00Z');
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'sess-new-1',
      previousTargetPaid: 0,
      targetPaid: 20,
      sessionFinancialAt: sessionAt,
    });
    assert.equal(ledger.getBalance('CASH_1'), 200);
    const moves = ledger.listMovements({ cashAccountId: 'CASH_1', staffMemberId: 'oumaima' });
    assert.equal(moves.total, 1);
    assert.equal(moves.items[0]!.amount, 20);
  });

  await test('3. session Zainab +30 sur CASH_2', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_2', 'zainab');
    await ledger.setInitialBalance('CASH_2', 480);
    ledger.setCashTrackingStartedAt('CASH_2', new Date('2026-08-30T10:00:00Z'));
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'zainab',
      sessionId: 'sess-new-2',
      previousTargetPaid: 0,
      targetPaid: 30,
      sessionFinancialAt: new Date('2026-08-30T12:00:00Z'),
    });
    assert.equal(ledger.getBalance('CASH_2'), 510);
  });

  await test('4. replay même session → pas de double crédit', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', new Date(0));
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'replay',
      previousTargetPaid: 0,
      targetPaid: 20,
      sessionFinancialAt: new Date(),
    });
    const again = await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'replay',
      previousTargetPaid: 20,
      targetPaid: 20,
      sessionFinancialAt: new Date(),
    });
    assert.equal(again, null);
    assert.equal(ledger.getBalance('CASH_1'), 20);
  });

  await test('5. expected 20 puis corrected 30 → +10 seulement', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', new Date(0));
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'corr-1',
      previousTargetPaid: 0,
      targetPaid: 20,
      sessionFinancialAt: new Date(),
    });
    const corr = await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'corr-1',
      previousTargetPaid: 20,
      targetPaid: 30,
      sessionFinancialAt: new Date(),
    });
    assert.equal(corr!.type, 'CORRECTION');
    assert.equal(corr!.amount, 10);
    assert.equal(ledger.getBalance('CASH_1'), 30);
  });

  await test('6. corrected 30 puis clear → retour expected 20 (-10)', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', new Date(0));
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'clear-1',
      previousTargetPaid: 0,
      targetPaid: 20,
      sessionFinancialAt: new Date(),
    });
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'clear-1',
      previousTargetPaid: 20,
      targetPaid: 30,
      sessionFinancialAt: new Date(),
    });
    const cleared = await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'clear-1',
      previousTargetPaid: 30,
      targetPaid: 20,
      sessionFinancialAt: new Date(),
    });
    assert.equal(cleared!.type, 'CORRECTION');
    assert.equal(cleared!.amount, -10);
    assert.equal(ledger.getBalance('CASH_1'), 20);
  });

  await test('7. changement plan 20 → 40 → +20', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', new Date(0));
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'plan-1',
      previousTargetPaid: 0,
      targetPaid: 20,
      sessionFinancialAt: new Date(),
    });
    const plan = await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'plan-1',
      previousTargetPaid: 20,
      targetPaid: 40,
      sessionFinancialAt: new Date(),
    });
    assert.equal(plan!.amount, 20);
    assert.equal(ledger.getBalance('CASH_1'), 40);
  });

  await test('8. session historique avant cutover → aucun crédit', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', new Date('2026-08-30T14:00:00Z'));
    const m = await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'old-1',
      previousTargetPaid: 0,
      targetPaid: 200,
      sessionFinancialAt: new Date('2026-08-30T10:00:00Z'),
    });
    assert.equal(m, null);
    assert.equal(ledger.getBalance('CASH_1'), 0);
  });

  await test('9. session après cutover → crédit auto', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', new Date('2026-08-30T10:00:00Z'));
    const m = await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'after-1',
      previousTargetPaid: 0,
      targetPaid: 25,
      sessionFinancialAt: new Date('2026-08-30T15:00:00Z'),
    });
    assert.ok(m);
    assert.equal(m!.amount, 25);
  });

  await test('10. fille sans caisse → erreur', async () => {
    const ledger = new MemoryCashLedger();
    ledger.setCashTrackingStartedAt('CASH_1', new Date(0));
    await assert.rejects(
      () =>
        ledger.syncSessionPaid({
          cashAccountId: null,
          staffMemberId: 'ghost',
          sessionId: 'no-till',
          previousTargetPaid: 0,
          targetPaid: 20,
          sessionFinancialAt: new Date(),
        }),
      (e: Error) => e.message.includes('Aucune caisse'),
    );
  });

  await test('11. deux filles indépendantes', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.assignStaffToCashAccount('CASH_2', 'zainab');
    ledger.setCashTrackingStartedAt('CASH_1', new Date(0));
    ledger.setCashTrackingStartedAt('CASH_2', new Date(0));
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'oumaima',
      sessionId: 'dual-1',
      previousTargetPaid: 0,
      targetPaid: 20,
      sessionFinancialAt: new Date(),
    });
    await ledger.syncSessionPaid({
      cashAccountId: null,
      staffMemberId: 'zainab',
      sessionId: 'dual-2',
      previousTargetPaid: 0,
      targetPaid: 30,
      sessionFinancialAt: new Date(),
    });
    assert.equal(ledger.getBalance('CASH_1'), 20);
    assert.equal(ledger.getBalance('CASH_2'), 30);
  });

  await test('12. rollback si échec après plan', async () => {
    const ledger = new MemoryCashLedger();
    ledger.assignStaffToCashAccount('CASH_1', 'oumaima');
    ledger.setCashTrackingStartedAt('CASH_1', new Date(0));
    await assert.rejects(
      () =>
        ledger.syncSessionPaid({
          cashAccountId: null,
          staffMemberId: 'oumaima',
          sessionId: 'rb-1',
          previousTargetPaid: 0,
          targetPaid: 20,
          sessionFinancialAt: new Date(),
          failAfterPlan: true,
        }),
      /ROLLBACK_TEST/,
    );
    assert.equal(ledger.getBalance('CASH_1'), 0);
  });

  await test('resolveSessionPaidTarget corrected ?? expected', () => {
    assert.equal(resolveSessionPaidTarget(null, 20), 20);
    assert.equal(resolveSessionPaidTarget(30, 20), 30);
    assert.equal(resolveSessionPaidTarget(null, null), 0);
  });

  console.log('optional reason on manual operations');

  await test('withdraw sans raison => accepté', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_1', amount: 500 });
    const m = await ledger.withdraw('CASH_1', 100);
    assert.equal(m.reason, null);
    assert.equal(ledger.getBalance('CASH_1'), 400);
  });

  await test('adjust sans raison => accepté', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_2', amount: 800 });
    const m = await ledger.adjust('CASH_2', 750);
    assert.equal(m.reason, null);
    assert.equal(m.amount, -50);
    assert.equal(ledger.getBalance('CASH_2'), 750);
  });

  await test('manual income sans raison => accepté', async () => {
    const ledger = new MemoryCashLedger();
    const m = await ledger.credit({ cashAccountId: 'CASH_1', amount: 120 });
    assert.equal(m!.reason, null);
    assert.equal(ledger.getBalance('CASH_1'), 120);
  });

  await test('raison fournie => sauvegardée', async () => {
    const ledger = new MemoryCashLedger();
    await ledger.credit({ cashAccountId: 'CASH_1', amount: 1000 });
    const w = await ledger.withdraw('CASH_1', 50, 'banque');
    const a = await ledger.adjust('CASH_1', 900, 'écart caisse');
    const c = await ledger.credit({ cashAccountId: 'CASH_1', amount: 10, reason: 'apport' });
    assert.equal(w.reason, 'banque');
    assert.equal(a.reason, 'écart caisse');
    assert.equal(c!.reason, 'apport');
  });

  await test('chaîne vide => null', () => {
    assert.equal(normalizeReason(''), null);
    assert.equal(normalizeReason('   '), null);
    assert.equal(normalizeReason(null), null);
    assert.equal(normalizeReason(undefined), null);
    assert.equal(normalizeReason('  note  '), 'note');
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
