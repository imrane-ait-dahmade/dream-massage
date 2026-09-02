/**
 * Self-start shift pure logic tests (no database).
 * Run: npm run test:self-start-shift
 */
import assert from 'node:assert/strict';
import { buildScheduledDatetime } from '../../utils/time';
import {
  resolveOpenShiftForSession,
  buildShiftAlreadyOpenMessage,
} from './shift-open-resolve.logic';
import {
  assertSelfStartShiftTypeAllowed,
  buildSelfStartSchedule,
} from './shift-self-start.logic';
import { evaluateShiftClose } from './shift-close.logic';
import { getDayBoundsUtc } from '../../utils/time';

const TZ = 'Africa/Casablanca';
const BUSINESS_DATE = '2026-09-01';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('shift-self-start logic tests');

// ── Open shift resolution (Shelly) ─────────────────────────────────────────────

test('0 OPEN → NO_OPEN_SHIFT', () => {
  const r = resolveOpenShiftForSession([]);
  assert.equal(r.shiftId, null);
  assert.equal(r.anomalyType, 'NO_OPEN_SHIFT');
});

test('1 OPEN → attach that shift', () => {
  const r = resolveOpenShiftForSession(['shift-oumaima']);
  assert.equal(r.shiftId, 'shift-oumaima');
  assert.equal(r.anomalyType, null);
});

test('>1 OPEN → MULTIPLE_OPEN_SHIFTS, no silent pick', () => {
  const r = resolveOpenShiftForSession(['shift-a', 'shift-b']);
  assert.equal(r.shiftId, null);
  assert.equal(r.anomalyType, 'MULTIPLE_OPEN_SHIFTS');
});

test('409 message format', () => {
  const msg = buildShiftAlreadyOpenMessage('Oumaima', 'Matin');
  assert.ok(msg.includes('Oumaima'));
  assert.ok(msg.includes('Matin'));
});

// ── Shift type validation ──────────────────────────────────────────────────────

test('MATIN shift type allowed', () => {
  assert.doesNotThrow(() =>
    assertSelfStartShiftTypeAllowed({
      id: '1',
      name: 'MATIN',
      startTime: '08:00',
      endTime: '15:00',
      isActive: true,
    }),
  );
});

test('JOURNEE shift type rejected', () => {
  assert.throws(
    () =>
      assertSelfStartShiftTypeAllowed({
        id: '1',
        name: 'JOURNEE',
        startTime: '08:00',
        endTime: '23:00',
        isActive: true,
      }),
    (e: Error & { status?: number }) => e.status === 400,
  );
});

// ── Schedule fields for self-start ─────────────────────────────────────────────

test('buildSelfStartSchedule sets businessDate and scheduledEndAt', () => {
  const s = buildSelfStartSchedule(
    { startTime: '08:00', endTime: '15:00' },
    BUSINESS_DATE,
    TZ,
  );
  assert.equal(s.businessDate, BUSINESS_DATE);
  assert.equal(
    s.scheduledEndAt.getTime(),
    buildScheduledDatetime(BUSINESS_DATE, '15:00', TZ).getTime(),
  );
});

// ── Auto-close still works without staffScheduleId ───────────────────────────

test('self-start shift closes at scheduledEndAt (SCHEDULE_END)', () => {
  const { start: todayStartUtc } = getDayBoundsUtc(BUSINESS_DATE, TZ);
  const scheduledEndAt = buildScheduledDatetime(BUSINESS_DATE, '15:00', TZ);
  const now = new Date(scheduledEndAt.getTime() + 60_000);

  const decision = evaluateShiftClose(
    {
      id: 'sh-1',
      status: 'OPEN',
      businessDate: BUSINESS_DATE,
      scheduledStartAt: buildScheduledDatetime(BUSINESS_DATE, '08:00', TZ),
      scheduledEndAt,
      startedAt: buildScheduledDatetime(BUSINESS_DATE, '08:10', TZ),
      staffMemberId: 'staff-1',
      shiftTypeId: 'matin-id',
    },
    now,
    BUSINESS_DATE,
    todayStartUtc,
    undefined,
    '23:45',
    TZ,
  );
  assert.equal(decision.close, true);
  assert.equal(decision.reason, 'SCHEDULE_END');
});

test('stale business date closes (STALE_BUSINESS_DATE)', () => {
  const { start: todayStartUtc } = getDayBoundsUtc('2026-09-02', TZ);
  const decision = evaluateShiftClose(
    {
      id: 'sh-1',
      status: 'OPEN',
      businessDate: BUSINESS_DATE,
      scheduledStartAt: null,
      scheduledEndAt: null,
      startedAt: buildScheduledDatetime(BUSINESS_DATE, '08:00', TZ),
      staffMemberId: 'staff-1',
      shiftTypeId: null,
    },
    buildScheduledDatetime('2026-09-02', '10:00', TZ),
    '2026-09-02',
    todayStartUtc,
  );
  assert.equal(decision.close, true);
  assert.equal(decision.reason, 'STALE_BUSINESS_DATE');
});

console.log('\nAll shift-self-start logic tests passed.');
