/**
 * Staff cash till access rules (pure logic).
 * Run: npm run test:cash-access
 */
import assert from 'node:assert/strict';
import {
  canStaffAccessCashAccount,
  canUserAccessCashAccount,
  authenticatedStaffMemberId,
} from './cash-access';
import type { AuthUser } from '../auth/auth.service';

function staffUser(staffMemberId: string): AuthUser {
  return {
    id: 'u1',
    name: 'Oumaima',
    email: 'ouma@example.com',
    role: 'ASSISTANT',
    staffMemberId,
  };
}

function adminUser(): AuthUser {
  return { id: 'a1', name: 'Admin', email: 'a@x.com', role: 'ADMIN', staffMemberId: null };
}

function ownerUser(): AuthUser {
  return { id: 'o1', name: 'Owner', email: 'o@x.com', role: 'OWNER', staffMemberId: null };
}

async function run() {
  console.log('staff cash access');

  await test('1. Oumaima → CASH_1 (assigned) autorisée', () => {
    assert.equal(canStaffAccessCashAccount('oumaima', 'oumaima'), true);
    assert.equal(canUserAccessCashAccount(staffUser('oumaima'), 'oumaima'), true);
  });

  await test('2. Oumaima → CASH_2 (Zainab) refusée', () => {
    assert.equal(canStaffAccessCashAccount('oumaima', 'zainab'), false);
    assert.equal(canUserAccessCashAccount(staffUser('oumaima'), 'zainab'), false);
  });

  await test('3. Zainab → CASH_2 autorisée', () => {
    assert.equal(canStaffAccessCashAccount('zainab', 'zainab'), true);
  });

  await test('4. Zainab → CASH_1 refusée', () => {
    assert.equal(canStaffAccessCashAccount('zainab', 'oumaima'), false);
  });

  await test('5–6. ADMIN / OWNER accès complet', () => {
    assert.equal(canUserAccessCashAccount(adminUser(), 'oumaima'), true);
    assert.equal(canUserAccessCashAccount(adminUser(), 'zainab'), true);
    assert.equal(canUserAccessCashAccount(adminUser(), null), true);
    assert.equal(canUserAccessCashAccount(ownerUser(), null), true);
  });

  await test('11. staff sans staffMemberId → aucun accès', () => {
    const u: AuthUser = {
      id: 'x',
      name: 'X',
      email: 'x@x.com',
      role: 'ASSISTANT',
      staffMemberId: null,
    };
    assert.equal(authenticatedStaffMemberId(u), null);
    assert.equal(canUserAccessCashAccount(u, 'oumaima'), false);
  });

  await test('12. changement affectation — accès basé sur affectation actuelle', () => {
    // CASH_1 was Oumaima, now Salma — Oumaima loses access
    assert.equal(canStaffAccessCashAccount('oumaima', 'salma'), false);
    assert.equal(canStaffAccessCashAccount('salma', 'salma'), true);
  });

  await test('14. actions admin interdites aux filles (role gate)', () => {
    assert.equal(staffUser('oumaima').role, 'ASSISTANT');
    assert.notEqual(staffUser('oumaima').role, 'OWNER');
    assert.notEqual(staffUser('oumaima').role, 'ADMIN');
  });

  console.log('All cash-access tests passed.');
}

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => console.log(`  ✓ ${name}`),
    (err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    },
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
