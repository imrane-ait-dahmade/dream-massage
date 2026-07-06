import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
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

const OPEN_SHIFT_SELECT = {
  id:               true,
  status:           true,
  businessDate:     true,
  scheduledStartAt: true,
  scheduledEndAt:   true,
  startedAt:        true,
  staffMemberId:    true,
  shiftTypeId:      true,
  staffMember:      { select: { name: true } },
} as const;

export type OpenShiftRow = {
  id:               string;
  status:           string;
  businessDate:     string | null;
  scheduledStartAt: Date | null;
  scheduledEndAt:   Date | null;
  startedAt:        Date;
  staffMemberId:    string;
  shiftTypeId:      string | null;
  staffMember:      { name: string };
};

export type AutoCloseShiftResult = {
  closed: boolean;
  shiftId: string;
};

export type CloseOpenShiftsBatchResult = {
  openFound: number;
  closed: number;
  closedIds: string[];
};

export class ShiftService {
  /**
   * Returns every shift still OPEN (endedAt null). No business-date filter.
   */
  async listOpenShifts(): Promise<OpenShiftRow[]> {
    return prisma.shift.findMany({
      where:   { status: 'OPEN', endedAt: null },
      orderBy: { startedAt: 'asc' },
      select:  OPEN_SHIFT_SELECT,
    });
  }

  /**
   * Idempotent automatic close. Safe to call multiple times on the same shift.
   * Only updates rows that are still OPEN with endedAt null.
   */
  async autoCloseShift(
    shiftId: string,
    opts: {
      reason: string;
      endedAt?: Date;
      closedByUserId?: string | null;
    },
  ): Promise<AutoCloseShiftResult> {
    const existing = await prisma.shift.findUnique({
      where:  { id: shiftId },
      select: { id: true, status: true, endedAt: true },
    });
    if (!existing || existing.status !== 'OPEN' || existing.endedAt !== null) {
      return { closed: false, shiftId };
    }

    try {
      await this.recalculateAndSaveShiftPrimeSummary(shiftId);
    } catch (err) {
      // Prime snapshot is best-effort for automatic closes.
      logger.warn(`[shift] Prime recalc failed for ${shiftId}: ${String(err)} — closing anyway`);
    }

    const result = await prisma.shift.updateMany({
      where: { id: shiftId, status: 'OPEN', endedAt: null },
      data: {
        status:              'CLOSED',
        endedAt:             opts.endedAt ?? new Date(),
        closedByUserId:      opts.closedByUserId ?? null,
        closedAutomatically: true,
        autoCloseReason:     opts.reason,
      },
    });

    return { closed: result.count > 0, shiftId };
  }

  /**
   * Opens a new shift for a staff member.
   * Stale OPEN shifts are closed first; only one OPEN shift at a time (shop-wide
   * when ALLOW_MULTIPLE_OPEN_SHIFTS=false).
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

    // Close lingering OPEN shifts before creating a new one (troubleshooting path).
    if (!env.ALLOW_MULTIPLE_OPEN_SHIFTS) {
      const lingering = await this.listOpenShifts();
      for (const open of lingering) {
        await this.autoCloseShift(open.id, {
          reason:          'BEFORE_MANUAL_OPEN',
          closedByUserId: openedByUserId,
        });
      }
    } else {
      const sameStaffOpen = await prisma.shift.findFirst({
        where:  { status: 'OPEN', endedAt: null, staffMemberId: input.staffMemberId },
        select: { id: true },
      });
      if (sameStaffOpen) {
        await this.autoCloseShift(sameStaffOpen.id, {
          reason:          'BEFORE_MANUAL_OPEN_SAME_STAFF',
          closedByUserId: openedByUserId,
        });
      }
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
   * Returns the currently active OPEN shift (endedAt must be null).
   */
  async getOpenShift() {
    return prisma.shift.findFirst({
      where:   { status: 'OPEN', endedAt: null },
      include: SHIFT_INCLUDE,
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Re-opens a CLOSED scheduled shift inside the same business-day window.
   * Idempotent when the row is already OPEN.
   */
  async reopenScheduledShift(
    shiftId: string,
    opts: {
      ownerId: string;
      scheduledStartAt: Date;
      scheduledEndAt: Date;
      businessDate: string;
    },
  ): Promise<boolean> {
    const result = await prisma.shift.updateMany({
      where: { id: shiftId, status: 'CLOSED' },
      data: {
        status:              'OPEN',
        endedAt:             null,
        closedByUserId:      null,
        closedAutomatically: false,
        autoCloseReason:     null,
        scheduledStartAt:    opts.scheduledStartAt,
        scheduledEndAt:      opts.scheduledEndAt,
        businessDate:        opts.businessDate,
        openedAutomatically: true,
        notes:               'Ré-ouvert automatiquement dans la fenêtre planifiée',
      },
    });
    return result.count > 0;
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
