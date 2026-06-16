import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import { autoShiftService } from '../shifts/auto-shift.service';
import { primeCalculationService } from '../prime/prime-calculation.service';
import { chairStateService } from '../chairs/chair-state.service';

// ── Fixed seed IDs ─────────────────────────────────────────────────────────────
// These must match server/prisma/seed.ts to ensure scenarios find seeded entities.

const IDS = {
  owner:          '00000000-0000-0000-0000-000000000001',
  demoStaff:      '00000000-0000-0000-0001-000000000001',
  plan20:         '00000000-0000-0000-0002-000000000001',
  plan30:         '00000000-0000-0000-0002-000000000002',
  plan40:         '00000000-0000-0000-0002-000000000003',
  shiftTypeMatin: '00000000-0000-0000-0004-000000000001',
  shiftTypeSoir:  '00000000-0000-0000-0004-000000000002',
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

function getBusinessDate(): string {
  const tz = env.APP_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).formatToParts(new Date());
  const y  = parts.find((p) => p.type === 'year')?.value  ?? '2000';
  const mo = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d  = parts.find((p) => p.type === 'day')?.value   ?? '01';
  return `${y}-${mo}-${d}`;
}

function todayDayOfWeek(): number {
  const short =
    new Intl.DateTimeFormat('en-US', { timeZone: env.APP_TIMEZONE, weekday: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'weekday')?.value ?? '';
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[short] ?? 1;
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

function minutesAgo(m: number): Date {
  return new Date(Date.now() - m * 60 * 1000);
}

// ── Service ────────────────────────────────────────────────────────────────────

class DevScenariosService {
  // ── Private helpers ──────────────────────────────────────────────────────────

  private async getEnabledChairs() {
    return prisma.chair.findMany({
      where:   { isEnabled: true },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true },
    });
  }

  private async ensureDemoStaff() {
    const staff = await prisma.staffMember.findUnique({
      where:  { id: IDS.demoStaff },
      select: { id: true, name: true },
    });
    if (!staff) {
      throw new Error('Demo Staff not found in DB — run: npm run prisma:seed');
    }
    return staff;
  }

  private async createClosedShift(
    staffMemberId: string,
    shiftTypeId:   string,
    startedAt:     Date,
    endedAt:       Date,
  ) {
    return prisma.shift.create({
      data: {
        staffMemberId,
        shiftTypeId,
        openedByUserId: IDS.owner,
        closedByUserId: IDS.owner,
        startedAt,
        endedAt,
        status:       'CLOSED',
        businessDate: getBusinessDate(),
      },
    });
  }

  private async createCompletedSession(params: {
    chairId:       string;
    shiftId:       string | null;
    planId:        string | null;
    expectedAmount: number;
    durationSeconds: number;
    billingStatus?: 'CALCULATED' | 'PENDING';
    anomalyType?:  string | null;
    offsetMinutes?: number; // minutes ago for startedAt (default: durationSeconds/60 + 1)
  }) {
    const {
      chairId, shiftId, planId, expectedAmount, durationSeconds,
      billingStatus = 'CALCULATED', anomalyType = null, offsetMinutes,
    } = params;
    const endedAt   = minutesAgo(offsetMinutes ?? 1);
    const startedAt = new Date(endedAt.getTime() - durationSeconds * 1000);
    return prisma.chairSession.create({
      data: {
        chairId,
        shiftId,
        status:          'COMPLETED',
        startedAt,
        endedAt,
        durationSeconds,
        matchedPlanId:  planId,
        expectedAmount,
        billingStatus,
        anomalyType,
      },
    });
  }

  // ── Reset ────────────────────────────────────────────────────────────────────

  async resetDemoData() {
    // Delete in FK-safe order:
    //   ChairEvents → ChairSessions → ShiftBonusAdjustments → Shifts
    const events   = await prisma.chairEvent.deleteMany({});
    const sessions = await prisma.chairSession.deleteMany({});
    const bonusAdj = await prisma.shiftBonusAdjustment.deleteMany({});
    const shifts   = await prisma.shift.deleteMany({});

    // Reset live chair state (status, currentSessionId, debounce timestamps)
    await prisma.chair.updateMany({
      data: {
        status:             'IDLE',
        currentSessionId:   null,
        maybeActiveSince:   null,
        maybeFinishedSince: null,
        stateChangedAt:     null,
      },
    });

    logger.info(
      `[dev] reset: events=${events.count} sessions=${sessions.count} ` +
      `bonusAdj=${bonusAdj.count} shifts=${shifts.count}`,
    );

    return {
      chairEventsDeleted:            events.count,
      chairSessionsDeleted:          sessions.count,
      shiftBonusAdjustmentsDeleted:  bonusAdj.count,
      shiftsDeleted:                 shifts.count,
    };
  }

  // ── Scenario A — normal_day ──────────────────────────────────────────────────

  async scenarioNormalDay() {
    const staff  = await this.ensureDemoStaff();
    const chairs = await this.getEnabledChairs();
    if (chairs.length < 3) {
      throw new Error(`normal_day requires at least 3 enabled chairs; found ${chairs.length}`);
    }
    const [c1, c2, c3] = chairs as [typeof chairs[0], typeof chairs[0], typeof chairs[0]];

    const shift = await this.createClosedShift(
      staff.id, IDS.shiftTypeMatin, hoursAgo(3), minutesAgo(30),
    );

    // F1=20min/20 MAD, F2=30min/30 MAD, F3=20min/20 MAD
    await this.createCompletedSession({ chairId: c1.id, shiftId: shift.id, planId: IDS.plan20, expectedAmount: 20, durationSeconds: 1200, offsetMinutes: 90 });
    await this.createCompletedSession({ chairId: c2.id, shiftId: shift.id, planId: IDS.plan30, expectedAmount: 30, durationSeconds: 1800, offsetMinutes: 60 });
    await this.createCompletedSession({ chairId: c3.id, shiftId: shift.id, planId: IDS.plan20, expectedAmount: 20, durationSeconds: 1200, offsetMinutes: 40 });

    const summary = await primeCalculationService.calculateShiftPrimeSummary(shift.id);

    return {
      scenario:     'normal_day',
      shift:        { id: shift.id, staffMemberName: staff.name, status: 'CLOSED' },
      sessions:     summary.sessions.length,
      grossRevenue: summary.totals.grossRevenue,
      targetBonus:  summary.totals.targetBonus,
      totalPrime:   summary.totals.totalPrime,
    };
  }

  // ── Scenario B — prime_bonus_matin ───────────────────────────────────────────
  // Creates 25 × 20 MAD sessions = 500 MAD gross → targetBonus = 50 MAD

  async scenarioPrimeBonusMatin() {
    const staff  = await this.ensureDemoStaff();
    const chairs = await this.getEnabledChairs();
    if (chairs.length === 0) throw new Error('No enabled chairs found');

    const shift = await this.createClosedShift(
      staff.id, IDS.shiftTypeMatin, hoursAgo(6), minutesAgo(30),
    );

    for (let i = 0; i < 25; i++) {
      const chair = chairs[i % chairs.length]!;
      await this.createCompletedSession({
        chairId: chair.id, shiftId: shift.id, planId: IDS.plan20,
        expectedAmount: 20, durationSeconds: 1200, offsetMinutes: 60 + i * 2,
      });
    }

    const summary = await primeCalculationService.calculateShiftPrimeSummary(shift.id);

    return {
      scenario:            'prime_bonus_matin',
      shift:               { id: shift.id, staffMemberName: staff.name, status: 'CLOSED' },
      sessions:            summary.sessions.length,
      grossRevenue:        summary.totals.grossRevenue,
      expectedTargetBonus: 50,
      actualTargetBonus:   summary.totals.targetBonus,
      targetBonusMatched:  summary.totals.targetBonus === 50,
    };
  }

  // ── Scenario C — prime_bonus_soir ────────────────────────────────────────────
  // Creates 25 × 40 MAD sessions = 1000 MAD gross → targetBonus = 100 MAD

  async scenarioPrimeBonusSoir() {
    const staff  = await this.ensureDemoStaff();
    const chairs = await this.getEnabledChairs();
    if (chairs.length === 0) throw new Error('No enabled chairs found');

    const shift = await this.createClosedShift(
      staff.id, IDS.shiftTypeSoir, hoursAgo(9), minutesAgo(30),
    );

    for (let i = 0; i < 25; i++) {
      const chair = chairs[i % chairs.length]!;
      await this.createCompletedSession({
        chairId: chair.id, shiftId: shift.id, planId: IDS.plan40,
        expectedAmount: 40, durationSeconds: 2400, offsetMinutes: 60 + i * 2,
      });
    }

    const summary = await primeCalculationService.calculateShiftPrimeSummary(shift.id);

    return {
      scenario:            'prime_bonus_soir',
      shift:               { id: shift.id, staffMemberName: staff.name, status: 'CLOSED' },
      sessions:            summary.sessions.length,
      grossRevenue:        summary.totals.grossRevenue,
      expectedTargetBonus: 100,
      actualTargetBonus:   summary.totals.targetBonus,
      targetBonusMatched:  summary.totals.targetBonus === 100,
    };
  }

  // ── Scenario D — anomalies_day ───────────────────────────────────────────────

  async scenarioAnomaliesDay() {
    const staff  = await this.ensureDemoStaff();
    const chairs = await this.getEnabledChairs();
    if (chairs.length < 2) {
      throw new Error(`anomalies_day requires at least 2 enabled chairs; found ${chairs.length}`);
    }
    const c1 = chairs[0]!;
    const c2 = chairs[1]!;

    const shift = await this.createClosedShift(
      staff.id, IDS.shiftTypeMatin, hoursAgo(4), minutesAgo(30),
    );

    // TOO_SHORT: 60s < minimumBillableSeconds (180s), expectedAmount=0, PENDING
    const s1 = await this.createCompletedSession({
      chairId: c1.id, shiftId: shift.id, planId: null,
      expectedAmount: 0, durationSeconds: 60,
      billingStatus: 'PENDING', anomalyType: 'TOO_SHORT', offsetMinutes: 120,
    });

    // TOO_LONG: 3600s > 40min plan + grace (2400+120=2520s), PENDING
    const s2 = await this.createCompletedSession({
      chairId: c2.id, shiftId: shift.id, planId: IDS.plan40,
      expectedAmount: 40, durationSeconds: 3600,
      billingStatus: 'PENDING', anomalyType: 'TOO_LONG', offsetMinutes: 90,
    });

    // NO_OPEN_SHIFT: shiftId=null — session occurred with no open shift
    const s3 = await this.createCompletedSession({
      chairId: c1.id, shiftId: null, planId: IDS.plan20,
      expectedAmount: 20, durationSeconds: 1200,
      billingStatus: 'CALCULATED', offsetMinutes: 60,
    });

    return {
      scenario: 'anomalies_day',
      shift:    { id: shift.id, status: 'CLOSED' },
      sessions: [
        { id: s1.id, anomaly: 'TOO_SHORT',     billingStatus: 'PENDING',     expectedAmount: 0  },
        { id: s2.id, anomaly: 'TOO_LONG',      billingStatus: 'PENDING',     expectedAmount: 40 },
        { id: s3.id, anomaly: 'NO_OPEN_SHIFT', billingStatus: 'CALCULATED',  expectedAmount: 20, shiftId: null },
      ],
    };
  }

  // ── Scenario E — correction_demo ─────────────────────────────────────────────

  async scenarioCorrectionDemo() {
    const staff  = await this.ensureDemoStaff();
    const chairs = await this.getEnabledChairs();
    if (chairs.length === 0) throw new Error('No enabled chairs found');
    const chair = chairs[0]!;

    const shift = await this.createClosedShift(
      staff.id, IDS.shiftTypeMatin, hoursAgo(2), minutesAgo(30),
    );

    const sessionStart = minutesAgo(100);
    const session = await prisma.chairSession.create({
      data: {
        chairId:          chair.id,
        shiftId:          shift.id,
        status:           'COMPLETED',
        startedAt:        sessionStart,
        endedAt:          new Date(sessionStart.getTime() + 1200 * 1000),
        durationSeconds:  1200,
        matchedPlanId:    IDS.plan20,
        expectedAmount:   20,
        correctedAmount:  25,
        billingStatus:    'CORRECTED',
        correctedByUserId: IDS.owner,
        correctedAt:      new Date(),
        correctionReason: 'Démo correction owner',
      },
    });

    return {
      scenario: 'correction_demo',
      shift:    { id: shift.id, status: 'CLOSED' },
      session:  {
        id:               session.id,
        expectedAmount:   20,
        correctedAmount:  25,
        finalAmount:      25,
        billingStatus:    'CORRECTED',
        correctionReason: session.correctionReason,
      },
    };
  }

  // ── Scenario F — auto_shift_demo ─────────────────────────────────────────────

  async scenarioAutoShiftDemo() {
    const staff = await this.ensureDemoStaff();
    const dow   = todayDayOfWeek();

    // Find existing active schedule for Demo Staff today, or create one
    let schedule = await prisma.staffSchedule.findFirst({
      where: { staffMemberId: staff.id, dayOfWeek: dow, isActive: true },
    });

    let scheduleCreated = false;
    if (!schedule) {
      schedule = await prisma.staffSchedule.create({
        data: {
          staffMemberId: staff.id,
          shiftTypeId:   IDS.shiftTypeMatin,
          dayOfWeek:     dow,
          startTime:     '00:00',
          endTime:       '23:59',
          isOff:         false,
          isActive:      true,
          notes:         '[demo] Wide-window test schedule — remove after testing',
        },
      });
      scheduleCreated = true;
      logger.info(`[dev] auto_shift_demo: created test schedule ${schedule.id} for DOW=${dow}`);
    }

    const result = await autoShiftService.runAutoShiftSync();

    return {
      scenario:        'auto_shift_demo',
      scheduleCreated,
      scheduleId:      schedule.id,
      dayOfWeek:       dow,
      autoShiftResult: result,
      note: scheduleCreated
        ? `Demo schedule created for day ${dow} (00:00–23:59). Delete it manually (id: ${schedule.id}) after testing.`
        : `Reused existing schedule ${schedule.id} for Demo Staff on day ${dow}.`,
    };
  }

  // ── Scenario G — full_demo_day ───────────────────────────────────────────────

  async scenarioFullDemoDay() {
    const resetResult  = await this.resetDemoData();
    const matin        = await this.scenarioPrimeBonusMatin();
    const soir         = await this.scenarioPrimeBonusSoir();
    const anomalies    = await this.scenarioAnomaliesDay();
    const correction   = await this.scenarioCorrectionDemo();
    const summary      = await this.getTestSummary();

    return {
      scenario:  'full_demo_day',
      reset:     resetResult,
      scenarios: { matin, soir, anomalies, correction },
      summary,
    };
  }

  // ── Chair reading proxy (name → id lookup) ───────────────────────────────────

  async injectChairReading(
    chairName: string,
    powerWatts: number,
    isOnline: boolean,
    relayIsOn?: boolean,
  ) {
    const chair = await prisma.chair.findFirst({
      where:  { name: chairName },
      select: { id: true, name: true },
    });
    if (!chair) {
      throw Object.assign(new Error(`Chair not found: ${chairName}`), { status: 404 });
    }

    await chairStateService.processChairReading(chair.id, {
      powerWatts,
      isOnline,
      relayIsOn,
      recordedAt: new Date(),
    });

    return { chairId: chair.id, chairName: chair.name, powerWatts, isOnline };
  }

  // ── Test summary ─────────────────────────────────────────────────────────────

  async getTestSummary() {
    const [agg, activeSessions, anomalySessions, correctedSessions, shiftAgg, staffCount, shiftsByStatus] =
      await Promise.all([
        prisma.chairSession.aggregate({
          _count: { _all: true },
          _sum:   { expectedAmount: true, correctedAmount: true },
        }),
        prisma.chairSession.count({ where: { status: 'ACTIVE' } }),
        prisma.chairSession.count({ where: { anomalyType: { not: null } } }),
        prisma.chairSession.count({ where: { billingStatus: 'CORRECTED' } }),
        prisma.shift.aggregate({ _count: { _all: true } }),
        prisma.staffMember.count({ where: { isActive: true } }),
        prisma.shift.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);

    return {
      sessions:          agg._count._all,
      totalRevenue:      Number(agg._sum.expectedAmount ?? 0),
      activeSessions,
      anomalySessions,
      correctedSessions,
      shifts:            shiftAgg._count._all,
      staffCount,
      shiftsByStatus:    shiftsByStatus.map((s) => ({ status: s.status, count: s._count._all })),
    };
  }
}

export const devScenariosService = new DevScenariosService();
