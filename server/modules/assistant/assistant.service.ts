import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { primeCalculationService } from '../prime/prime-calculation.service';
import type { AuthUser } from '../auth/auth.service';
import { getBusinessDate, getDayBoundsUtc } from '../../utils/time';
import type {
  AssistantAlert,
  AssistantDashboardResponse,
  AssistantMeResponse,
  AssistantSessionRow,
  AssistantSessionsListResponse,
  AssistantSummary,
} from './assistant.types';

function toNum(v: Prisma.Decimal | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

function resolveFinalAmount(
  expected: Prisma.Decimal | null,
  corrected: Prisma.Decimal | null,
): number {
  if (corrected !== null) return toNum(corrected);
  return toNum(expected);
}

function isOutOfRule(anomalyType: string | null): boolean {
  return !!anomalyType && anomalyType.length > 0;
}

function mapSessionRow(s: {
  id: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  expectedAmount: Prisma.Decimal | null;
  correctedAmount: Prisma.Decimal | null;
  billingStatus: string;
  anomalyType: string | null;
  correctionReason: string | null;
  chair: { name: string };
  matchedPlan: { name: string } | null;
}): AssistantSessionRow {
  return {
    id: s.id,
    chairName: s.chair.name,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    durationSeconds: s.durationSeconds,
    matchedPlanName: s.matchedPlan?.name ?? null,
    expectedAmount: toNum(s.expectedAmount),
    correctedAmount: s.correctedAmount !== null ? toNum(s.correctedAmount) : null,
    finalAmount: resolveFinalAmount(s.expectedAmount, s.correctedAmount),
    billingStatus: s.billingStatus,
    anomalyType: s.anomalyType,
    correctionReason: s.correctionReason,
  };
}

function emptySummary(): AssistantSummary {
  return {
    grossRevenue: 0,
    planCommission: 0,
    targetBonus: 0,
    manualBonus: 0,
    totalPrime: 0,
    netRevenue: 0,
    sessionsCount: 0,
    completedSessionsCount: 0,
    pendingSessionsCount: 0,
    correctedSessionsCount: 0,
    outOfRuleSessionsCount: 0,
  };
}

function buildSummaryFromSessions(
  sessions: Array<{ status: string; billingStatus: string; anomalyType: string | null }>,
): Pick<
  AssistantSummary,
  | 'sessionsCount'
  | 'completedSessionsCount'
  | 'pendingSessionsCount'
  | 'correctedSessionsCount'
  | 'outOfRuleSessionsCount'
> {
  let pendingSessionsCount = 0;
  let correctedSessionsCount = 0;
  let outOfRuleSessionsCount = 0;
  let completedSessionsCount = 0;

  for (const s of sessions) {
    if (s.status === 'COMPLETED') completedSessionsCount += 1;
    if (
      s.status === 'ACTIVE' ||
      s.status === 'UNCERTAIN' ||
      s.billingStatus === 'PENDING' ||
      s.billingStatus === 'DISPUTED'
    ) {
      pendingSessionsCount += 1;
    }
    if (s.billingStatus === 'CORRECTED') correctedSessionsCount += 1;
    if (isOutOfRule(s.anomalyType)) outOfRuleSessionsCount += 1;
  }

  return {
    sessionsCount: sessions.length,
    completedSessionsCount,
    pendingSessionsCount,
    correctedSessionsCount,
    outOfRuleSessionsCount,
  };
}

function buildAlerts(
  sessions: Array<{
    id: string;
    status: string;
    billingStatus: string;
    anomalyType: string | null;
  }>,
): AssistantAlert[] {
  const alerts: AssistantAlert[] = [];

  for (const s of sessions) {
    if (
      s.status === 'ACTIVE' ||
      s.status === 'UNCERTAIN' ||
      s.billingStatus === 'PENDING' ||
      s.billingStatus === 'DISPUTED'
    ) {
      alerts.push({
        type: 'PENDING_SESSION',
        message: 'Une session est à vérifier.',
        sessionId: s.id,
      });
    }
    if (s.billingStatus === 'CORRECTED') {
      alerts.push({
        type: 'CORRECTED_SESSION',
        message: 'Une session a été corrigée par le gérant.',
        sessionId: s.id,
      });
    }
    if (isOutOfRule(s.anomalyType)) {
      alerts.push({
        type: 'OUT_OF_RULE',
        message: 'Une session est hors règle.',
        sessionId: s.id,
      });
    }
  }

  return alerts;
}

async function resolveStaffMemberId(
  user: AuthUser,
  requestedStaffMemberId?: string,
): Promise<string> {
  if (user.role === 'ASSISTANT') {
    if (!user.staffMemberId) {
      const err = new Error('Forbidden');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }
    // Always scope to the authenticated assistant — ignore tampered query params.
    return user.staffMemberId;
  }

  if (!requestedStaffMemberId) {
    const err = new Error('staffMemberId query parameter is required for admin preview');
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return requestedStaffMemberId;
}

export class AssistantService {
  async getMe(user: AuthUser): Promise<AssistantMeResponse> {
    if (user.role !== 'ASSISTANT' || !user.staffMemberId) {
      const err = new Error('Forbidden');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }

    const staffMember = await prisma.staffMember.findUnique({
      where: { id: user.staffMemberId },
      select: { id: true, name: true, isActive: true },
    });

    if (!staffMember || !staffMember.isActive) {
      const err = new Error('Forbidden');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'ASSISTANT',
      },
      staffMember: { id: staffMember.id, name: staffMember.name },
    };
  }

  async getTodayDashboard(
    user: AuthUser,
    params: { date?: string; shiftId?: string; staffMemberId?: string },
  ): Promise<AssistantDashboardResponse> {
    const date = params.date ?? getBusinessDate();
    const staffMemberId = await resolveStaffMemberId(user, params.staffMemberId);
    const { start, end } = getDayBoundsUtc(date);

    const staffMember = await prisma.staffMember.findUnique({
      where: { id: staffMemberId },
      select: { id: true, name: true, isActive: true },
    });
    if (!staffMember || !staffMember.isActive) {
      const err = new Error('Staff member not found');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }

    if (params.shiftId) {
      const shift = await prisma.shift.findUnique({
        where: { id: params.shiftId },
        select: { staffMemberId: true },
      });
      if (!shift || shift.staffMemberId !== staffMemberId) {
        const err = new Error('Forbidden');
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
    }

    const shifts = await prisma.shift.findMany({
      where: {
        staffMemberId,
        ...(params.shiftId
          ? { id: params.shiftId }
          : {
              OR: [
                { businessDate: date },
                { startedAt: { gte: start, lt: end } },
              ],
            }),
      },
      include: { shiftType: true },
      orderBy: { startedAt: 'asc' },
    });

    const shiftIds = shifts.map((s) => s.id);

    const rawSessions =
      shiftIds.length > 0
        ? await prisma.chairSession.findMany({
            where: { shiftId: { in: shiftIds } },
            include: {
              chair: { select: { name: true } },
              matchedPlan: { select: { name: true } },
            },
            orderBy: { startedAt: 'desc' },
          })
        : [];

    const sessions = rawSessions.map(mapSessionRow);

    const summary = emptySummary();
    Object.assign(summary, buildSummaryFromSessions(rawSessions));

    for (const shift of shifts) {
      try {
        const prime = await primeCalculationService.calculateShiftPrimeSummary(shift.id);
        summary.grossRevenue += prime.totals.grossRevenue;
        summary.planCommission += prime.totals.planCommission;
        summary.targetBonus += prime.totals.targetBonus;
        summary.manualBonus += prime.totals.manualBonus;
        summary.totalPrime += prime.totals.totalPrime;
        summary.netRevenue += prime.totals.netRevenue;
      } catch {
        // Shift may have no calculable prime yet — skip
      }
    }

    const openShift = shifts.find((s) => s.status === 'OPEN') ?? null;
    const currentShift = openShift
      ? {
          id: openShift.id,
          shiftTypeLabel: openShift.shiftType?.label ?? openShift.shiftType?.name ?? null,
          status: openShift.status,
          startedAt: openShift.startedAt.toISOString(),
          scheduledEndAt: openShift.scheduledEndAt?.toISOString() ?? null,
        }
      : null;

    return {
      date,
      staffMember: { id: staffMember.id, name: staffMember.name },
      currentShift,
      summary,
      sessions,
      alerts: buildAlerts(rawSessions),
    };
  }

  async listSessions(
    user: AuthUser,
    params: {
      date?: string;
      shiftId?: string;
      staffMemberId?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<AssistantSessionsListResponse> {
    const date = params.date ?? getBusinessDate();
    const staffMemberId = await resolveStaffMemberId(user, params.staffMemberId);
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const { start, end } = getDayBoundsUtc(date);

    const staffMember = await prisma.staffMember.findUnique({
      where: { id: staffMemberId },
      select: { id: true, name: true },
    });
    if (!staffMember) {
      const err = new Error('Staff member not found');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }

    let shiftIds: string[] | undefined;
    if (params.shiftId) {
      const shift = await prisma.shift.findUnique({
        where: { id: params.shiftId },
        select: { staffMemberId: true },
      });
      if (!shift || shift.staffMemberId !== staffMemberId) {
        const err = new Error('Forbidden');
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
      shiftIds = [params.shiftId];
    } else {
      const shifts = await prisma.shift.findMany({
        where: {
          staffMemberId,
          OR: [
            { businessDate: date },
            { startedAt: { gte: start, lt: end } },
          ],
        },
        select: { id: true },
      });
      shiftIds = shifts.map((s) => s.id);
    }

    if (shiftIds.length === 0) {
      return {
        date,
        staffMember: { id: staffMember.id, name: staffMember.name },
        sessions: [],
        page,
        limit,
        total: 0,
      };
    }

    const where: Prisma.ChairSessionWhereInput = {
      shiftId: { in: shiftIds },
      ...(params.status ? { status: params.status as Prisma.EnumSessionStatusFilter['equals'] } : {}),
    };

    const [total, rawSessions] = await Promise.all([
      prisma.chairSession.count({ where }),
      prisma.chairSession.findMany({
        where,
        include: {
          chair: { select: { name: true } },
          matchedPlan: { select: { name: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      date,
      staffMember: { id: staffMember.id, name: staffMember.name },
      sessions: rawSessions.map(mapSessionRow),
      page,
      limit,
      total,
    };
  }
}

export const assistantService = new AssistantService();
