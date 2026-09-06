/**
 * DB-backed stale session recovery — startup, reconcile, shift close.
 */
import type { ChairStatus, SessionStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  evaluateStaleSessionRecovery,
  isBlockingActiveSession,
  type StaleSessionCandidate,
} from './session-stale-recovery.logic';
import {
  finalizeActiveSession,
  markSessionNeedsReview,
} from './session-finalize.service';
import { FALLBACK_CONFIG } from '../chairs/chair-runtime-cache';
import { clearSessionMem, getChairMem, upsertChairMem } from '../chairs/chair-runtime-cache';
import { buildChairDisableBlockedMessage } from './session-stale-recovery.logic';

export { buildChairDisableBlockedMessage };

let lastRecoveryAtMs = 0;
const RECOVERY_MIN_INTERVAL_MS = 30_000;

/** Chairs that may need stale session recovery (enabled or disabled). */
function staleActiveChairWhere() {
  return {
    OR: [
      { status: { in: ['ACTIVE', 'MAYBE_FINISHED'] as ChairStatus[] }, currentSessionId: { not: null } },
      { sessions: { some: { status: 'ACTIVE' as SessionStatus } } },
    ],
  };
}

async function countOpenShifts(): Promise<number> {
  return prisma.shift.count({ where: { status: 'OPEN', endedAt: null } });
}

async function lastLowPowerEventMs(sessionId: string): Promise<number | null> {
  const ev = await prisma.chairEvent.findFirst({
    where: { sessionId, eventType: 'LOW_POWER_DETECTED' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return ev?.createdAt.getTime() ?? null;
}

function effectiveStopConfirmSeconds(raw: number): number {
  return env.SIMULATION_FAST_MODE ? 10 : raw;
}

async function buildCandidate(
  chair: {
    id: string;
    name: string;
    status: string;
    currentPowerWatts: number | null;
    maybeFinishedSince: Date | null;
    detectionConfigs: Array<{ stopThresholdWatts: number; stopConfirmSeconds: number }>;
  },
  session: {
    id: string;
    status: string;
    startedAt: Date;
    shiftId: string | null;
    lowPowerDetectedAt: Date | null;
    anomalyType: string | null;
    minPowerWatts: number | null;
    maxPowerWatts: number | null;
    startPowerWatts: number | null;
  },
  shiftStatus: string | null,
  hasOpenShopShift: boolean,
  nowMs: number,
): Promise<StaleSessionCandidate> {
  const cfg = chair.detectionConfigs[0];
  const stopThreshold = cfg?.stopThresholdWatts ?? FALLBACK_CONFIG.stopThresholdWatts;
  const stopConfirm = effectiveStopConfirmSeconds(
    cfg?.stopConfirmSeconds ?? FALLBACK_CONFIG.stopConfirmSeconds,
  );
  const lastLow = await lastLowPowerEventMs(session.id);

  return {
    sessionId: session.id,
    chairId: chair.id,
    chairStatus: chair.status,
    sessionStatus: session.status,
    startedAtMs: session.startedAt.getTime(),
    maybeFinishedSinceMs: chair.maybeFinishedSince?.getTime() ?? null,
    lowPowerDetectedAtMs: session.lowPowerDetectedAt?.getTime() ?? null,
    lastLowPowerEventMs: lastLow,
    currentPowerWatts: chair.currentPowerWatts,
    stopThresholdWatts: stopThreshold,
    stopConfirmSeconds: stopConfirm,
    nowMs,
    shiftId: session.shiftId,
    shiftStatus,
    hasOpenShopShift,
  };
}

async function applyRecoveryDecision(
  chairName: string,
  session: {
    id: string;
    startedAt: Date;
    anomalyType: string | null;
    minPowerWatts: number | null;
    maxPowerWatts: number | null;
    startPowerWatts: number | null;
  },
  chairId: string,
  decision: ReturnType<typeof evaluateStaleSessionRecovery>,
  endPowerWatts: number,
  recoveryReasonOverride?: string,
): Promise<boolean> {
  if (decision.action === 'none') return false;

  if (decision.action === 'mark_review') {
    await markSessionNeedsReview(session.id, chairId, decision.reason);
    const mem = getChairMem(chairId);
    if (mem) {
      mem.status = 'IDLE';
      mem.currentSessionId = null;
      mem.maybeFinishedSince = null;
      mem.session = null;
      upsertChairMem(mem);
    }
    return true;
  }

  const endedAt = new Date(decision.endedAtMs);
  await finalizeActiveSession({
    sessionId: session.id,
    chairId,
    chairName,
    startedAt: session.startedAt,
    endedAt,
    confirmedEndAt: endedAt,
    lowPowerDetectedAt: endedAt,
    endPowerWatts,
    minPowerWatts: session.minPowerWatts,
    maxPowerWatts: session.maxPowerWatts,
    avgPowerWatts: null,
    existingAnomalyType: session.anomalyType,
    recoveryReason: recoveryReasonOverride ?? decision.reason,
  });

  const mem = getChairMem(chairId);
  if (mem) {
    mem.status = 'IDLE';
    mem.currentSessionId = null;
    mem.maybeFinishedSince = null;
    clearSessionMem(mem);
    upsertChairMem(mem);
  }
  return true;
}

const CHAIR_STALE_INCLUDE = {
  detectionConfigs: { where: { isActive: true }, take: 1 },
  sessions: {
    where: { status: 'ACTIVE' as const },
    take: 1,
    orderBy: { startedAt: 'desc' as const },
    include: { shift: { select: { status: true } } },
  },
} as const;

async function loadChairForStaleRecovery(chairId: string) {
  return prisma.chair.findUnique({
    where: { id: chairId },
    include: CHAIR_STALE_INCLUDE,
  });
}

/** Recover one chair's ACTIVE session if stale rules apply. Returns true if recovered. */
export async function recoverChairSession(
  chairId: string,
  opts?: { recoveryReasonOverride?: string },
): Promise<boolean> {
  const chair = await loadChairForStaleRecovery(chairId);
  if (!chair) return false;
  const session = chair.sessions[0];
  if (!session) return false;

  const openCount = await countOpenShifts();
  const nowMs = Date.now();
  const candidate = await buildCandidate(
    chair,
    session,
    session.shift?.status ?? null,
    openCount === 1,
    nowMs,
  );
  const decision = evaluateStaleSessionRecovery(candidate);
  const power = chair.currentPowerWatts ?? session.minPowerWatts ?? 0;
  return applyRecoveryDecision(
    chair.name,
    session,
    chair.id,
    decision,
    power,
    opts?.recoveryReasonOverride,
  );
}

/**
 * Before disabling a chair: block real active massages, finalize stale recoverable sessions.
 */
export async function prepareChairForDisable(chairId: string): Promise<void> {
  const chair = await loadChairForStaleRecovery(chairId);
  if (!chair) return;

  const session = chair.sessions[0];
  if (!session) return;

  const cfg = chair.detectionConfigs[0];
  const stopThreshold = cfg?.stopThresholdWatts ?? FALLBACK_CONFIG.stopThresholdWatts;

  if (
    isBlockingActiveSession({
      sessionStatus: session.status,
      chairStatus: chair.status,
      currentPowerWatts: chair.currentPowerWatts,
      stopThresholdWatts: stopThreshold,
    })
  ) {
    throw Object.assign(new Error(buildChairDisableBlockedMessage()), { status: 409 });
  }

  const openCount = await countOpenShifts();
  const nowMs = Date.now();
  const candidate = await buildCandidate(
    chair,
    session,
    session.shift?.status ?? null,
    openCount === 1,
    nowMs,
  );
  const decision = evaluateStaleSessionRecovery(candidate);
  const power = chair.currentPowerWatts ?? session.minPowerWatts ?? 0;

  if (decision.action === 'finalize') {
    await applyRecoveryDecision(
      chair.name,
      session,
      chair.id,
      decision,
      power,
      'CHAIR_DISABLE',
    );
  } else if (decision.action === 'mark_review') {
    await markSessionNeedsReview(session.id, chair.id, decision.reason);
    const mem = getChairMem(chairId);
    if (mem) {
      mem.status = 'IDLE';
      mem.currentSessionId = null;
      mem.maybeFinishedSince = null;
      mem.session = null;
      upsertChairMem(mem);
    }
  }

  const stillActive = await prisma.chairSession.findFirst({
    where: { chairId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (stillActive) {
    throw Object.assign(new Error(buildChairDisableBlockedMessage()), { status: 409 });
  }
}

/** Scan all chairs with ACTIVE sessions and recover stale ones. */
export async function runStaleSessionRecovery(force = false): Promise<number> {
  const nowMs = Date.now();
  if (!force && nowMs - lastRecoveryAtMs < RECOVERY_MIN_INTERVAL_MS) {
    return 0;
  }
  lastRecoveryAtMs = nowMs;

  const chairs = await prisma.chair.findMany({
    where: staleActiveChairWhere(),
    include: CHAIR_STALE_INCLUDE,
  });

  let recovered = 0;
  for (const chair of chairs) {
    if (await recoverChairSession(chair.id)) {
      recovered++;
    }
  }

  if (recovered > 0) {
    logger.info(`[stale-recovery] Recovered ${recovered} stale session(s)`);
  }
  return recovered;
}

/** Finalize MAYBE_FINISHED + low-power sessions tied to a shift before close. */
export async function finalizeRecoverableSessionsForShift(shiftId: string): Promise<number> {
  const openCount = await countOpenShifts();
  const hasOpenShopShift = openCount >= 1;
  const nowMs = Date.now();

  const sessions = await prisma.chairSession.findMany({
    where: { shiftId, status: 'ACTIVE' },
    include: {
      chair: {
        include: { detectionConfigs: { where: { isActive: true }, take: 1 } },
      },
    },
  });

  let finalized = 0;
  for (const session of sessions) {
    const chair = session.chair;
    const candidate = await buildCandidate(
      chair,
      session,
      'OPEN',
      hasOpenShopShift,
      nowMs,
    );
    const decision = evaluateStaleSessionRecovery(candidate);
    if (decision.action !== 'finalize') continue;
    const power = chair.currentPowerWatts ?? session.minPowerWatts ?? 0;
    if (await applyRecoveryDecision(chair.name, session, chair.id, decision, power)) {
      finalized++;
    }
  }
  return finalized;
}

export type ShiftCloseSessionAssessment = {
  blockingCount: number;
  blockingSessionIds: string[];
};

/** After recoverable finalizations, count sessions that still block manual close. */
export async function assessShiftCloseSessions(
  shiftId: string,
): Promise<ShiftCloseSessionAssessment> {
  const sessions = await prisma.chairSession.findMany({
    where: { shiftId, status: 'ACTIVE' },
    select: {
      id: true,
      chair: {
        select: {
          status: true,
          currentPowerWatts: true,
          detectionConfigs: {
            where: { isActive: true },
            take: 1,
            select: { stopThresholdWatts: true },
          },
        },
      },
    },
  });

  const blockingSessionIds: string[] = [];
  for (const s of sessions) {
    const stopThreshold =
      s.chair.detectionConfigs[0]?.stopThresholdWatts ?? FALLBACK_CONFIG.stopThresholdWatts;
    if (
      isBlockingActiveSession({
        sessionStatus: 'ACTIVE',
        chairStatus: s.chair.status,
        currentPowerWatts: s.chair.currentPowerWatts,
        stopThresholdWatts: stopThreshold,
      })
    ) {
      blockingSessionIds.push(s.id);
    }
  }

  return { blockingCount: blockingSessionIds.length, blockingSessionIds };
}

export async function prepareShiftForClose(shiftId: string): Promise<ShiftCloseSessionAssessment> {
  await finalizeRecoverableSessionsForShift(shiftId);
  return assessShiftCloseSessions(shiftId);
}

export function buildShiftCloseBlockedMessage(count: number): string {
  return `Impossible de terminer le shift : ${count} session(s) sont encore en cours.`;
}

/** For auto-close: finalize recoverable; skip close if real sessions remain. */
export async function canAutoCloseShift(shiftId: string): Promise<boolean> {
  const assessment = await prepareShiftForClose(shiftId);
  if (assessment.blockingCount > 0) {
    logger.warn(
      `[shift] Auto-close blocked for ${shiftId}: ${assessment.blockingCount} active session(s) ` +
        `(ids=[${assessment.blockingSessionIds.map((id) => id.slice(-8)).join(', ')}])`,
    );
    return false;
  }
  return true;
}
