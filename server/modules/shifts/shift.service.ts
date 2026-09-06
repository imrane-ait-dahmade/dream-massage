import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { getBusinessDate, getTimezone } from '../../utils/time';
import { primeCalculationService } from '../prime/prime-calculation.service';
import type { ShiftPrimeSummary } from '../prime/prime-calculation.service';
import { syncShiftPrimeToCash } from '../cash/shift-cash-sync';
import { assessShiftDeletion } from './shift-delete.logic';
import {
  assertSelfStartShiftTypeAllowed,
  buildSelfStartSchedule,
} from './shift-self-start.logic';
import {
  canAutoCloseShift,
  finalizeRecoverableSessionsForShift,
  assessShiftCloseSessions,
} from '../sessions/session-stale-recovery.service';
import {
  buildShiftAlreadyOpenMessage,
  resolveOpenShiftForSession,
  type OpenShiftResolveResult,
} from './shift-open-resolve.logic';

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

export type ShiftConflictInfo = {
  id: string;
  staffMember: { id: string; name: string };
  shiftType: { id: string | null; label: string | null; name: string | null };
};

export type CloseOpenShiftsBatchResult = {
  openFound: number;
  closed: number;
  closedIds: string[];
};

export class ShiftService {
  /**
   * Resolves the single shop-wide OPEN shift for new ChairSession attribution.
   * 0 OPEN → NO_OPEN_SHIFT; 1 OPEN → attach; >1 OPEN → log error, MULTIPLE_OPEN_SHIFTS.
   */
  async resolveOpenShiftForSession(): Promise<OpenShiftResolveResult> {
    const openShifts = await prisma.shift.findMany({
      where:   { status: 'OPEN', endedAt: null },
      orderBy: { startedAt: 'desc' },
      select:  { id: true },
    });
    const result = resolveOpenShiftForSession(openShifts.map((s) => s.id));
    if (result.anomalyType === 'MULTIPLE_OPEN_SHIFTS') {
      logger.error(
        `[shift] INVALID: ${openShifts.length} OPEN shifts — refusing session attribution ` +
        `(ids=[${openShifts.map((s) => s.id).join(', ')}])`,
      );
    }
    return result;
  }

  /**
   * Returns the currently OPEN shift with staff/type info (for 409 responses).
   */
  async getOpenShiftConflict(): Promise<ShiftConflictInfo | null> {
    const row = await prisma.shift.findFirst({
      where:   { status: 'OPEN', endedAt: null },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        staffMember: { select: { id: true, name: true } },
        shiftType:   { select: { id: true, name: true, label: true } },
      },
    });
    if (!row) return null;
    return {
      id:          row.id,
      staffMember: row.staffMember,
      shiftType: {
        id:    row.shiftType?.id ?? null,
        name:  row.shiftType?.name ?? null,
        label: row.shiftType?.label ?? row.shiftType?.name ?? null,
      },
    };
  }

  /**
   * ASSISTANT self-start: opens a shift for the authenticated staff member.
   * Fails with 409 if any shop-wide OPEN shift exists (does not auto-close).
   * Uses a transaction + row lock for concurrency safety.
   */
  async startAssistantShift(
    shiftTypeId: string,
    openedByUserId: string,
    staffMemberId: string,
  ) {
    const tz           = getTimezone();
    const businessDate = getBusinessDate(tz);
    const now          = new Date();

    const staff = await prisma.staffMember.findUnique({
      where:  { id: staffMemberId },
      select: { id: true, name: true, isActive: true, archivedAt: true },
    });
    if (!staff || !staff.isActive || staff.archivedAt) {
      throw Object.assign(new Error('Membre du staff introuvable ou inactif'), { status: 404 });
    }

    const shiftType = await prisma.shiftType.findUnique({
      where:  { id: shiftTypeId },
      select: { id: true, name: true, label: true, startTime: true, endTime: true, isActive: true },
    });
    assertSelfStartShiftTypeAllowed(shiftType);

    const cashAccount = await prisma.cashAccount.findFirst({
      where: {
        staffMemberId,
        isActive: true,
        code:     { in: ['CASH_1', 'CASH_2'] },
      },
      select: { id: true, code: true, name: true },
    });
    if (!cashAccount) {
      throw Object.assign(
        new Error('Aucune caisse physique n\'est affectée à votre compte. Contactez le gérant.'),
        { status: 422 },
      );
    }

    const schedule = buildSelfStartSchedule(shiftType!, businessDate, tz);

    try {
      return await prisma.$transaction(async (tx) => {
        // Serialize concurrent start attempts (shop-wide).
        await tx.$queryRaw`SELECT id FROM shifts WHERE status = 'OPEN' AND ended_at IS NULL FOR UPDATE`;

        const existingOpen = await tx.shift.findMany({
          where:   { status: 'OPEN', endedAt: null },
          select:  {
            id: true,
            staffMemberId: true,
            staffMember:   { select: { name: true } },
            shiftType:     { select: { label: true, name: true } },
          },
        });

        if (existingOpen.length > 0) {
          const blocker = existingOpen[0]!;
          const label   = blocker.shiftType?.label ?? blocker.shiftType?.name ?? 'Shift';
          throw Object.assign(
            new Error(buildShiftAlreadyOpenMessage(blocker.staffMember.name, label)),
            {
              status: 409,
              currentShift: {
                id:          blocker.id,
                staffMember: { id: blocker.staffMemberId, name: blocker.staffMember.name },
                shiftType:   {
                  label: blocker.shiftType?.label ?? blocker.shiftType?.name ?? null,
                },
              },
            },
          );
        }

        return tx.shift.create({
          data: {
            staffMemberId:       staffMemberId,
            shiftTypeId:         shiftTypeId,
            cashAccountId:       cashAccount.id,
            businessDate:        schedule.businessDate,
            scheduledStartAt:    schedule.scheduledStartAt,
            scheduledEndAt:      schedule.scheduledEndAt,
            startedAt:           now,
            status:              'OPEN',
            openedByUserId:      openedByUserId,
            openedAutomatically: false,
            staffScheduleId:     null,
            notes:               'Ouvert par l\'assistante',
          },
          include: SHIFT_INCLUDE,
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const conflict = await this.getOpenShiftConflict();
        if (conflict) {
          const label = conflict.shiftType.label ?? conflict.shiftType.name ?? 'Shift';
          throw Object.assign(
            new Error(buildShiftAlreadyOpenMessage(conflict.staffMember.name, label)),
            { status: 409, currentShift: conflict },
          );
        }
        throw Object.assign(new Error('Un shift est déjà en cours.'), { status: 409 });
      }
      throw err;
    }
  }

  /**
   * ASSISTANT close: only the staff member's own OPEN shift.
   */
  async closeAssistantShift(
    closedByUserId: string,
    staffMemberId: string,
    declaredCash?: number,
  ) {
    const open = await prisma.shift.findFirst({
      where: { status: 'OPEN', endedAt: null, staffMemberId },
      select: { id: true },
    });
    if (!open) {
      throw Object.assign(
        new Error('Aucun shift ouvert pour votre compte.'),
        { status: 404 },
      );
    }
    return this.closeShift(open.id, closedByUserId, declaredCash);
  }

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

    if (!(await canAutoCloseShift(shiftId, { reason: opts.reason }))) {
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
    input: { staffMemberId: string; shiftTypeId?: string; cashAccountId: string },
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

    if (!input.cashAccountId?.trim()) {
      throw Object.assign(new Error('cashAccountId est obligatoire'), { status: 400 });
    }
    const cashAccount = await prisma.cashAccount.findUnique({
      where:  { id: input.cashAccountId },
      select: { id: true, isActive: true, code: true, name: true },
    });
    if (!cashAccount) {
      throw Object.assign(new Error('Caisse introuvable'), { status: 404 });
    }
    if (!cashAccount.isActive) {
      throw Object.assign(new Error('Cette caisse est inactive'), { status: 400 });
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
      // Also close any OPEN shift already on this physical till
      const sameTillOpen = await prisma.shift.findFirst({
        where:  { status: 'OPEN', endedAt: null, cashAccountId: input.cashAccountId },
        select: { id: true },
      });
      if (sameTillOpen) {
        await this.autoCloseShift(sameTillOpen.id, {
          reason:          'BEFORE_MANUAL_OPEN_SAME_TILL',
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
        cashAccountId:  input.cashAccountId,
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

    await finalizeRecoverableSessionsForShift(shiftId);
    const sessionBlock = await assessShiftCloseSessions(shiftId);
    if (sessionBlock.blockingCount > 0) {
      // Manual close: sessions belong to this shift — allow cross-shift handoff finish.
      logger.info(
        `[shift] Manual close ${shiftId} with ${sessionBlock.blockingCount} active session(s) ` +
          `(cross-shift allowed)`,
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

    await syncShiftPrimeToCash(shiftId);

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

  /**
   * Hard-deletes a shift. Linked sessions are preserved and detached (shiftId → null).
   * Bonus adjustments for the shift are removed with the shift row.
   */
  async deleteShift(shiftId: string, userId?: string): Promise<void> {
    const existing = await prisma.shift.findUnique({
      where:  { id: shiftId },
      select: {
        id:             true,
        staffMemberId:  true,
        businessDate:   true,
        status:         true,
        _count:         { select: { sessions: true, bonusAdjustments: true } },
      },
    });
    if (!existing) {
      throw Object.assign(new Error(`Shift introuvable : ${shiftId}`), { status: 404 });
    }

    const assessment = assessShiftDeletion({ sessionCount: existing._count.sessions });
    if (!assessment.canDelete) {
      throw Object.assign(
        new Error(`Suppression impossible : ${assessment.blockers.join(', ')}.`),
        { status: 409, blockers: assessment.blockers },
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (existing._count.sessions > 0) {
          await tx.chairSession.updateMany({
            where: { shiftId },
            data:  { shiftId: null },
          });
        }
        if (existing._count.bonusAdjustments > 0) {
          await tx.shiftBonusAdjustment.deleteMany({ where: { shiftId } });
        }
        await tx.shift.delete({ where: { id: shiftId } });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2003' || err.code === 'P2014') {
          throw Object.assign(
            new Error(
              'Suppression impossible : ce shift est encore référencé par d\'autres données.',
            ),
            { status: 409 },
          );
        }
      }
      throw err;
    }

    try {
      await prisma.settingsAuditLog.create({
        data: {
          userId,
          entityType: 'Shift',
          entityId:   shiftId,
          action:     'HARD_DELETE',
          oldValue: {
            staffMemberId: existing.staffMemberId,
            businessDate:  existing.businessDate,
            status:        existing.status,
            detachedSessions: existing._count.sessions,
          },
        },
      });
    } catch (err) {
      logger.warn('[shift] Audit log write failed:', String(err));
    }
  }
}

export const shiftService = new ShiftService();
