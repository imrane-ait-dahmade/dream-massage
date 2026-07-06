import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimeToMinutes,
  findShiftTypeOverlapError,
  validateShiftTypeTimeRange,
  rangesOverlap,
  SHIFT_TYPE_OVERLAP_MESSAGE,
} from './shift-time-ranges';

test('parseTimeToMinutes', () => {
  assert.equal(parseTimeToMinutes('08:00'), 480);
  assert.equal(parseTimeToMinutes('15:00'), 900);
  assert.equal(parseTimeToMinutes('invalid'), null);
});

test('rangesOverlap detects 15:00-16:00 overlap', () => {
  assert.equal(rangesOverlap('08:00', '16:00', '15:00', '23:45'), true);
  assert.equal(rangesOverlap('08:00', '15:00', '15:00', '23:45'), false);
});

test('validateShiftTypeTimeRange rejects end before start', () => {
  assert.match(validateShiftTypeTimeRange('16:00', '08:00') ?? '', /après/);
});

test('findShiftTypeOverlapError for Matin/Soir', () => {
  const err = findShiftTypeOverlapError(
    { name: 'MATIN', startTime: '08:00', endTime: '16:00' },
    [{ id: 'soir', name: 'SOIR', startTime: '15:00', endTime: '23:45', isActive: true }],
  );
  assert.equal(err, SHIFT_TYPE_OVERLAP_MESSAGE);
});

test('valid Matin + Soir adjacent windows', () => {
  const err = findShiftTypeOverlapError(
    { name: 'MATIN', startTime: '08:00', endTime: '15:00' },
    [{ id: 'soir', name: 'SOIR', startTime: '15:00', endTime: '23:45', isActive: true }],
  );
  assert.equal(err, null);
});

test('findShiftTypeOverlapError skips non-allowed types', () => {
  const err = findShiftTypeOverlapError(
    { name: 'MATIN', startTime: '08:00', endTime: '16:00' },
    [{ id: 'j', name: 'JOURNEE', startTime: '08:00', endTime: '20:00', isActive: true }],
  );
  assert.equal(err, null);
});
