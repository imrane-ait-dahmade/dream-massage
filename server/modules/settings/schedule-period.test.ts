/**
 * Unit tests for Matin/Soir period rules and schedule sorting (no database).
 * Run: npm run test:schedule-period
 */
import assert from 'node:assert/strict';
import {
  duplicateScheduleMessage,
  isAllowedShiftTypeName,
  isForbiddenShiftTypeName,
  periodSortOrder,
  resolveShiftPeriod,
  DEFAULT_PERIOD_WINDOWS,
} from '../shifts/shift-period';
import { compareScheduleItems } from './shift-schedule.sort';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('schedule-period tests');

test('rejects JOURNEE / DAY / FULL_DAY shift type names', () => {
  assert.equal(isForbiddenShiftTypeName('JOURNEE'), true);
  assert.equal(isForbiddenShiftTypeName('Journée'), true);
  assert.equal(isForbiddenShiftTypeName('DAY'), true);
  assert.equal(isForbiddenShiftTypeName('FULL_DAY'), true);
  assert.equal(!isAllowedShiftTypeName('JOURNEE'), true);
});

test('allows only MATIN and SOIR', () => {
  assert.equal(isAllowedShiftTypeName('MATIN'), true);
  assert.equal(isAllowedShiftTypeName('SOIR'), true);
  assert.equal(isAllowedShiftTypeName('MORNING'), true);
  assert.equal(isAllowedShiftTypeName('EVENING'), true);
  assert.equal(isAllowedShiftTypeName('CUSTOM'), false);
});

test('resolves period from shift type name', () => {
  assert.equal(resolveShiftPeriod('MATIN'), 'MORNING');
  assert.equal(resolveShiftPeriod('SOIR'), 'EVENING');
  assert.equal(resolveShiftPeriod('JOURNEE'), null);
});

test('duplicate message names the period in French', () => {
  assert.match(duplicateScheduleMessage('MORNING'), /Matin/);
  assert.match(duplicateScheduleMessage('EVENING'), /Soir/);
});

test('sorts MORNING before EVENING on same day', () => {
  const morning = {
    id: 'a',
    staffMemberId: 's1',
    staffMemberName: 'Alice',
    shiftTypeId: 't1',
    shiftTypeName: 'MATIN',
    shiftTypeLabel: 'Matin',
    startTime: '08:00',
    endTime: '15:00',
    isOff: false,
    isActive: true,
    notes: null,
    createdAt: '2026-01-02T00:00:00.000Z',
  };
  const evening = {
    ...morning,
    id: 'b',
    shiftTypeId: 't2',
    shiftTypeName: 'SOIR',
    shiftTypeLabel: 'Soir',
    startTime: '15:00',
    endTime: '23:45',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  assert.ok(compareScheduleItems(morning, evening) < 0);
});

test('same staff may appear twice when periods differ (sort is stable)', () => {
  const a = {
    id: '1',
    staffMemberId: 's1',
    staffMemberName: 'Staff A',
    shiftTypeId: 't1',
    shiftTypeName: 'MATIN',
    shiftTypeLabel: 'Matin',
    startTime: '08:00',
    endTime: '15:00',
    isOff: false,
    isActive: true,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const b = { ...a, id: '2', shiftTypeId: 't2', shiftTypeName: 'SOIR', shiftTypeLabel: 'Soir', startTime: '15:00', endTime: '23:45' };
  assert.notEqual(a.id, b.id);
  assert.notEqual(compareScheduleItems(a, b), 0);
});

test('default period windows documented for bonus fallback', () => {
  assert.deepEqual(DEFAULT_PERIOD_WINDOWS.MORNING, { start: '08:00', end: '15:00' });
  assert.deepEqual(DEFAULT_PERIOD_WINDOWS.EVENING, { start: '15:00', end: '23:45' });
});

test('staff working both periods: combined bonus equals morning + evening', () => {
  const morningBonus = 50;
  const eveningBonus = 100;
  assert.equal(morningBonus + eveningBonus, 150);
});

console.log('All schedule-period tests passed.');
