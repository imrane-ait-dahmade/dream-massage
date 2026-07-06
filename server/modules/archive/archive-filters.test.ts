/**
 * Unit tests for archive filter helpers (no database).
 * Run: npm run test:archive
 */
import assert from 'node:assert/strict';
import {
  parseVisibilityFilter,
  staffListWhere,
  scheduleListWhere,
  SCHEDULE_OPERATIONAL_WHERE,
  STAFF_VISIBLE_WHERE,
  SESSION_OPERATIONAL_WHERE,
} from './archive-filters';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('archive-filters tests');

test('defaults visibility to active', () => {
  assert.equal(parseVisibilityFilter(undefined), 'active');
  assert.equal(parseVisibilityFilter('invalid'), 'active');
});

test('staff visible filter requires non-archived active', () => {
  assert.deepEqual(STAFF_VISIBLE_WHERE, { archivedAt: null, isActive: true });
});

test('archived staff list filter', () => {
  assert.deepEqual(staffListWhere('archived'), { archivedAt: { not: null } });
});

test('operational schedule excludes archived', () => {
  assert.equal(SCHEDULE_OPERATIONAL_WHERE.archivedAt, null);
  assert.equal(SCHEDULE_OPERATIONAL_WHERE.isActive, true);
});

test('active schedule list hides archived rows', () => {
  const w = scheduleListWhere('active');
  assert.equal(w.isActive, true);
  assert.equal(w.archivedAt, null);
});

test('operational sessions exclude archived', () => {
  assert.deepEqual(SESSION_OPERATIONAL_WHERE, { archivedAt: null });
});

console.log('All archive-filters tests passed.');
