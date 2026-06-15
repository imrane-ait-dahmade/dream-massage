import { prisma } from '../../prisma';
import { primeCalculationService } from '../prime/prime-calculation.service';
import type { ShiftPrimeSummary } from '../prime/prime-calculation.service';

// ── Reusable include block for shift responses ─────────────────────────────────

const SHIFT_INCLUDE = {
  staffMember: { select: { id: true, name: true } },
  shiftType:   { select: { id: true, name: true, label: true, startTime: true, endTime: true } },
  openedBy:    { select: { id: true, name: true } },
  closedBy:    { select: { id: true, name: true } },
  _count:      { select: { sessions: true } },
} as const;

export class ShiftService {
  /**
   * Opens a new shift for a staff member.
   * Only one OPEN shift is allowed at a time (enforced by the
   * unique_open_shift partial index in RAW_SQL_CONSTRAINTS.md).
   */
  async openShift(
    input: { staffMemberId: string; shiftTypeId?: string },
    openedByUserId: string,
  ) {
    // Validate staff member
    const staff = await prisma.staffMember.findUnique({
      where:  { id: input.staffMemberId },
      select: { id: true, name: true, isActive: true },
    });
    if (!staff) {
      throw Object.assign(new Error('Membre du staff introuvable'), { status: 404 });
    }
    if (!staff.isActive) {
      throw Object.assign(new Error('Ce membre du staff est inactif'), { status: 400 });
    }

    // Validate shift type if provided
    if (input.shiftTypeId) {
      const st = await prisma.shiftType.findUnique({
        where:  { id: input.shiftTypeId },
        select: { id: true },
      });
      if (!st) {
        throw Object.assign(new Error('Type de shift introuvable'), { status: 404 });
      }
    }

    // Guard: only one OPEN shift at a time
    const existingOpen = await prisma.shift.findFirst({
      where:  { status: 'OPEN' },
      select: { id: true, staffMember: { select: { name: true } } },
    });
    if (existingOpen) {
      throw Object.assign(
        new Error(`Un shift est déjà ouvert (${existingOpen.staffMember.name})`),
        { status: 409 },
      );
    }

    return prisma.shift.create({
      data: {
        staffMemberId:  input.staffMemberId,
        openedByUserId: openedByUserId,
        startedAt:      new Date(),
        status:         'OPEN',
        shiftTypeId:    input.shiftTypeId ?? null,
      },
      include: SHIFT_INCLUDE,
    });
  }

  /**
   * Returns the currently OPEN shift, or null if none is open.
   */
  async getOpenShift() {
    return prisma.shift.findFirst({
      where:   { status: 'OPEN' },
      include: SHIFT_INCLUDE,
    });
  }

  /**
   * Closes the shift identified by shiftId.
   * Calculates and persists the prime summary, then sets status=CLOSED.
   * declaredCash is accepted to record what the staff member counted.
   */
  async closeShift(
    shiftId: string,
    closedByUserId: string,
    declaredCash?: number,
  ) {
    const existing = await prisma.shift.findUnique({
      where:  { id: shiftId },
      select: { id: true, status: true, grossRevenue: true },
    });
    if (!existing) {
      throw Object.assign(new Error(`Shift introuvable : ${shiftId}`), { status: 404 });
    }
    if (existing.status !== 'OPEN') {
      throw Object.assign(
        new Error(`Le shift n'est pas ouvert (status: ${existing.status})`),
        { status: 400 },
      );
    }

    // Recalculate prime before closing so snapshot is current
    await this.recalculateAndSaveShiftPrimeSummary(shiftId);

    // Compute difference: declaredCash vs expectedCash (= grossRevenue mirrored at recalc)
    const decl = declaredCash ?? null;

    const closed = await prisma.shift.update({
      where: { id: shiftId },
      data: {
        status:         'CLOSED',
        endedAt:        new Date(),
        closedByUserId: closedByUserId,
        declaredCash:   decl,
        differenceCash: decl != null && existing.grossRevenue != null
          ? decl - Number(existing.grossRevenue)
          : null,
      },
      include: SHIFT_INCLUDE,
    });

    return closed;
  }

  /**
   * Calculates the full prime summary and persists the snapshot columns to the
   * Shift row. Safe to call multiple times — overwrites previous values.
   *
   * Does NOT close the shift. Call this after close or on-demand via the endpoint.
   *
   * TODO: when shift.service.ts implements open/close, call this at close time
   *       and include the summary in the close response.
   *
   * TODO: decide if Shift.differenceCash should compare declaredCash with
   *       grossRevenue (what was expected) or netRevenue (after prime deduction).
   */
  async recalculateAndSaveShiftPrimeSummary(shiftId: string): Promise<ShiftPrimeSummary> {
    // Verify shift exists before computing (gives a cleaner error than Prisma P2025)
    const existing = await prisma.shift.findUnique({
      where:  { id: shiftId },
      select: { id: true },
    });
    if (!existing) throw new Error(`Shift not found: ${shiftId}`);

    const summary = await primeCalculationService.calculateShiftPrimeSummary(shiftId);
    const t = summary.totals;

    await prisma.shift.update({
      where: { id: shiftId },
      data: {
        grossRevenue:   t.grossRevenue,
        planCommission: t.planCommission,
        targetBonus:    t.targetBonus,
        manualBonus:    t.manualBonus,
        totalPrime:     t.totalPrime,
        netRevenue:     t.netRevenue,
        // Mirror grossRevenue into expectedCash for cash-reconciliation display.
        // declaredCash is NOT touched — it is entered by the staff at close time.
        expectedCash:   t.grossRevenue,
      },
    });

    return summary;
  }

  /**
   * Adds a manual bonus adjustment then immediately recalculates and saves the
   * prime summary.  amount can be negative (deduction).
   */
  async addBonusAdjustment(
    shiftId:  string,
    userId:   string | undefined,
    amount:   number,
    reason?:  string,
  ): Promise<ShiftPrimeSummary> {
    const existing = await prisma.shift.findUnique({
      where:  { id: shiftId },
      select: { id: true },
    });
    if (!existing) throw new Error(`Shift not found: ${shiftId}`);

    await prisma.shiftBonusAdjustment.create({
      data: {
        shiftId,
        amount,
        reason:          reason ?? null,
        createdByUserId: userId ?? null,
      },
    });

    return this.recalculateAndSaveShiftPrimeSummary(shiftId);
  }
}

export const shiftService = new ShiftService();
