import { Prisma } from '@prisma/client';
import type { ChairStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { pricingService } from '../pricing/pricing.service';
import { syncSessionCashLedgerInTx } from '../cash/session-cash-sync';
import { usageMetrics } from '../../utils/usage-metrics';
import type { PowerReading } from './chair.types';
import {
  decideTransition,
  powerChanged,
  type TransitionKind,
} from './chair-state.logic';
import {
  bindSessionMem,
  clearSessionMem,
  getChairMem,
  hydrateRuntimeCache,
  isRuntimeHydrated,
  sampleSessionPower,
  upsertChairMem,
  type ChairMem,
  type DetectionConfigMem,
} from './chair-runtime-cache';

function mergeAnomalyTypes(existing: string | null, added: string | null): string | null {
  if (!existing && !added) return null;
  if (!existing) return added;
  if (!added) return existing;
  const parts = existing.split(',');
  for (const part of added.split(',')) {
    if (!parts.includes(part)) parts.push(part);
  }
  return parts.join(',');
}

interface EffectiveConfig extends DetectionConfigMem {
  effectiveStartConfirmSeconds: number;
  effectiveStopConfirmSeconds: number;
}

function toEffective(cfg: DetectionConfigMem): EffectiveConfig {
  return {
    ...cfg,
    effectiveStartConfirmSeconds: env.SIMULATION_FAST_MODE ? 5 : cfg.startConfirmSeconds,
    effectiveStopConfirmSeconds: env.SIMULATION_FAST_MODE ? 10 : cfg.stopConfirmSeconds,
  };
}

/** Test/observability: last tick DB write count (0 = memory-only tick). */
let lastTickDbWrites = 0;
export function getLastTickDbWrites(): number {
  return lastTickDbWrites;
}

export class ChairStateService {
  /**
   * Process one Shelly reading for a chair.
   * Uses in-memory state; writes DB only on real business transitions
   * (or when live fields must be marked dirty for periodic flush).
   */
  async processChairReading(chairId: string, reading: PowerReading): Promise<TransitionKind> {
    lastTickDbWrites = 0;
    const now = reading.recordedAt ?? new Date();

    if (!isRuntimeHydrated()) {
      await hydrateRuntimeCache();
      usageMetrics.incr('dbReads');
    }

    let chair = getChairMem(chairId);
    if (!chair) {
      // Chair may have been enabled after hydrate — one-shot load
      usageMetrics.incr('dbReads');
      lastTickDbWrites += 1; // count as DB access
      const row = await prisma.chair.findUnique({
        where: { id: chairId },
        include: {
          detectionConfigs: { where: { isActive: true }, take: 1 },
          sessions: { where: { status: 'ACTIVE' }, take: 1, orderBy: { startedAt: 'desc' } },
        },
      });
      if (!row || !row.isEnabled) {
        logger.warn(`[state-machine] Chair ${chairId} not found or disabled`);
        return 'NONE';
      }
      // Re-hydrate all to stay consistent
      await hydrateRuntimeCache();
      chair = getChairMem(chairId);
      if (!chair) return 'NONE';
    }

    if (!chair.isEnabled) return 'NONE';
    if (chair.status === 'MAINTENANCE' || chair.status === 'ERROR') return 'NONE';

    const effective = toEffective(chair.config);
    const kind = decideTransition({
      status: chair.status,
      powerWatts: reading.powerWatts,
      isOnline: reading.isOnline,
      startThresholdWatts: effective.startThresholdWatts,
      stopThresholdWatts: effective.stopThresholdWatts,
      startConfirmSeconds: effective.effectiveStartConfirmSeconds,
      stopConfirmSeconds: effective.effectiveStopConfirmSeconds,
      maybeActiveSinceMs: chair.maybeActiveSince?.getTime() ?? null,
      maybeFinishedSinceMs: chair.maybeFinishedSince?.getTime() ?? null,
      nowMs: now.getTime(),
    });

    // ── Offline ──────────────────────────────────────────────────────────────
    if (kind === 'OFFLINE') {
      await this._handleOffline(chair, now);
      return kind;
    }
    if (kind === 'ONLINE_RECOVERY') {
      await this._handleOnlineRecovery(chair, now);
      // Continue with recovered status on same reading
      return this.processChairReading(chairId, reading);
    }

    // Update in-memory live fields (no DB yet)
    const liveChanged =
      powerChanged(chair.currentPowerWatts, reading.powerWatts) ||
      chair.isOnline !== true ||
      (reading.relayIsOn !== undefined && reading.relayIsOn !== chair.relayIsOn);

    chair.isOnline = true;
    chair.lastSyncedAt = now;
    chair.lastOnlineAt = now;
    if (liveChanged) {
      chair.currentPowerWatts = reading.powerWatts;
      if (reading.relayIsOn !== undefined) chair.relayIsOn = reading.relayIsOn;
      chair.dirtyLive = true;
    }

    // Active session: aggregate power in memory only
    if (chair.status === 'ACTIVE' || chair.status === 'MAYBE_FINISHED') {
      sampleSessionPower(chair, reading.powerWatts);
    }

    if (kind === 'NONE' || kind === 'POWER_SAMPLE_ONLY') {
      // No business transition — zero DB writes this tick
      upsertChairMem(chair);
      return kind;
    }

    // Real transition → DB write
    usageMetrics.incr('stateTransitions');
    switch (kind) {
      case 'IDLE_TO_MAYBE_ACTIVE':
        await this._idleToMaybeActive(chair, reading.powerWatts, now);
        break;
      case 'MAYBE_ACTIVE_TO_IDLE':
        await this._maybeActiveToIdle(chair, reading.powerWatts, now);
        break;
      case 'MAYBE_ACTIVE_TO_ACTIVE':
        await this._startSession(chair, reading.powerWatts, effective, now);
        break;
      case 'ACTIVE_TO_MAYBE_FINISHED':
        await this._activeToMaybeFinished(chair, reading.powerWatts, now);
        break;
      case 'MAYBE_FINISHED_TO_ACTIVE':
        await this._maybeFinishedToActive(chair, reading.powerWatts, now);
        break;
      case 'MAYBE_FINISHED_TO_IDLE':
        await this._endSession(chair, reading.powerWatts, now);
        break;
      default:
        break;
    }

    upsertChairMem(chair);
    return kind;
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  private async _idleToMaybeActive(chair: ChairMem, powerWatts: number, now: Date): Promise<void> {
    chair.status = 'MAYBE_ACTIVE';
    chair.maybeActiveSince = now;
    chair.stateChangedAt = now;
    chair.dirtyLive = false; // status write covers live fields
    lastTickDbWrites += 2;
    usageMetrics.incr('dbWrites', 2);
    await prisma.chair.update({
      where: { id: chair.id },
      data: {
        status: 'MAYBE_ACTIVE',
        maybeActiveSince: now,
        stateChangedAt: now,
        currentPowerWatts: powerWatts,
        isOnline: true,
        lastSyncedAt: now,
        lastOnlineAt: now,
      },
      select: { id: true },
    });
    await this._event(chair.id, null, 'START_DETECTED', 'IDLE', 'MAYBE_ACTIVE', powerWatts, null, now);
    logger.info(`[state-machine] ${chair.name}: IDLE → MAYBE_ACTIVE (${powerWatts.toFixed(1)}W)`);
  }

  private async _maybeActiveToIdle(chair: ChairMem, powerWatts: number, now: Date): Promise<void> {
    chair.status = 'IDLE';
    chair.maybeActiveSince = null;
    chair.stateChangedAt = now;
    lastTickDbWrites += 2;
    usageMetrics.incr('dbWrites', 2);
    await prisma.chair.update({
      where: { id: chair.id },
      data: {
        status: 'IDLE',
        maybeActiveSince: null,
        stateChangedAt: now,
        currentPowerWatts: powerWatts,
        isOnline: true,
        lastSyncedAt: now,
      },
      select: { id: true },
    });
    await this._event(chair.id, null, 'START_CANCELLED', 'MAYBE_ACTIVE', 'IDLE', powerWatts, null, now);
    logger.info(`[state-machine] ${chair.name}: MAYBE_ACTIVE → IDLE (power dropped ${powerWatts.toFixed(1)}W)`);
  }

  private async _activeToMaybeFinished(chair: ChairMem, powerWatts: number, now: Date): Promise<void> {
    const session = chair.session;
    if (!session) {
      logger.warn(`[state-machine] ${chair.name}: ACTIVE but no session — recovering to IDLE`);
      chair.status = 'IDLE';
      chair.currentSessionId = null;
      chair.stateChangedAt = now;
      lastTickDbWrites += 1;
      usageMetrics.incr('dbWrites');
      await prisma.chair.update({
        where: { id: chair.id },
        data: { status: 'IDLE', currentSessionId: null, stateChangedAt: now },
        select: { id: true },
      });
      return;
    }

    const newMin = Math.min(session.power.min ?? powerWatts, powerWatts);
    const newMax = Math.max(session.power.max ?? powerWatts, powerWatts);
    session.power.min = newMin;
    session.power.max = newMax;
    session.dirtyMetrics = false;

    chair.status = 'MAYBE_FINISHED';
    chair.maybeFinishedSince = now;
    chair.stateChangedAt = now;

    lastTickDbWrites += 3;
    usageMetrics.incr('dbWrites', 3);
    await prisma.$transaction(async (tx) => {
      await tx.chairSession.update({
        where: { id: session.id },
        data: { minPowerWatts: newMin, maxPowerWatts: newMax },
        select: { id: true },
      });
      await tx.chair.update({
        where: { id: chair.id },
        data: {
          status: 'MAYBE_FINISHED',
          maybeFinishedSince: now,
          stateChangedAt: now,
          currentPowerWatts: powerWatts,
          isOnline: true,
          lastSyncedAt: now,
        },
        select: { id: true },
      });
      await tx.chairEvent.create({
        data: {
          chairId: chair.id,
          sessionId: session.id,
          eventType: 'LOW_POWER_DETECTED',
          fromStatus: 'ACTIVE',
          toStatus: 'MAYBE_FINISHED',
          powerWatts,
          createdAt: now,
        },
        select: { id: true },
      });
    });
    logger.info(
      `[state-machine] ${chair.name}: ACTIVE → MAYBE_FINISHED (${powerWatts.toFixed(1)}W)`,
    );
  }

  private async _maybeFinishedToActive(chair: ChairMem, powerWatts: number, now: Date): Promise<void> {
    const sessionId = chair.session?.id ?? null;
    chair.status = 'ACTIVE';
    chair.maybeFinishedSince = null;
    chair.stateChangedAt = now;
    lastTickDbWrites += 2;
    usageMetrics.incr('dbWrites', 2);
    await prisma.chair.update({
      where: { id: chair.id },
      data: {
        status: 'ACTIVE',
        maybeFinishedSince: null,
        stateChangedAt: now,
        currentPowerWatts: powerWatts,
        isOnline: true,
        lastSyncedAt: now,
      },
      select: { id: true },
    });
    await this._event(chair.id, sessionId, 'POWER_RECOVERED', 'MAYBE_FINISHED', 'ACTIVE', powerWatts, null, now);
    logger.info(`[state-machine] ${chair.name}: MAYBE_FINISHED → ACTIVE (recovered ${powerWatts.toFixed(1)}W)`);
  }

  private async _startSession(
    chair: ChairMem,
    powerWatts: number,
    cfg: EffectiveConfig,
    now: Date,
  ): Promise<void> {
    const maybeActiveSince = chair.maybeActiveSince!;

    usageMetrics.incr('dbReads');
    lastTickDbWrites += 1;
    const existing = await prisma.chairSession.findFirst({
      where: { chairId: chair.id, status: 'ACTIVE' },
      select: {
        id: true,
        startedAt: true,
        anomalyType: true,
        minPowerWatts: true,
        maxPowerWatts: true,
        startPowerWatts: true,
      },
    });
    if (existing) {
      logger.warn(`[state-machine] ${chair.name}: active session already exists — correcting chair state`);
      chair.status = 'ACTIVE';
      chair.currentSessionId = existing.id;
      chair.maybeActiveSince = null;
      chair.stateChangedAt = now;
      bindSessionMem(chair, {
        id: existing.id,
        startedAt: existing.startedAt,
        anomalyType: existing.anomalyType,
        startPower: existing.startPowerWatts ?? powerWatts,
      });
      lastTickDbWrites += 1;
      usageMetrics.incr('dbWrites');
      await prisma.chair.update({
        where: { id: chair.id },
        data: {
          status: 'ACTIVE',
          currentSessionId: existing.id,
          maybeActiveSince: null,
          stateChangedAt: now,
        },
        select: { id: true },
      });
      return;
    }

    usageMetrics.incr('dbReads');
    lastTickDbWrites += 1;
    const openShift = await prisma.shift.findFirst({
      where: { status: 'OPEN', endedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    const anomalyType: string | null = openShift ? null : 'NO_OPEN_SHIFT';

    lastTickDbWrites += 4;
    usageMetrics.incr('dbWrites', 4);
    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.chairSession.create({
        data: {
          chairId: chair.id,
          shiftId: openShift?.id ?? null,
          status: 'ACTIVE',
          detectedStartAt: maybeActiveSince,
          confirmedStartAt: now,
          startedAt: maybeActiveSince,
          startPowerWatts: powerWatts,
          minPowerWatts: powerWatts,
          maxPowerWatts: powerWatts,
          avgPowerWatts: powerWatts,
          detectionConfigId: cfg.id !== 'fallback' ? cfg.id : null,
          detectionSnapshot: {
            startThresholdWatts: cfg.startThresholdWatts,
            stopThresholdWatts: cfg.stopThresholdWatts,
            startConfirmSeconds: cfg.startConfirmSeconds,
            stopConfirmSeconds: cfg.stopConfirmSeconds,
            activationDelaySeconds: cfg.activationDelaySeconds,
            baselinePowerWatts: cfg.baselinePowerWatts,
            fastModeApplied: env.SIMULATION_FAST_MODE,
          },
          anomalyType,
        },
        select: { id: true, startedAt: true, anomalyType: true },
      });
      await tx.chair.update({
        where: { id: chair.id },
        data: {
          status: 'ACTIVE',
          currentSessionId: s.id,
          maybeActiveSince: null,
          stateChangedAt: now,
          currentPowerWatts: powerWatts,
          isOnline: true,
          lastSyncedAt: now,
        },
        select: { id: true },
      });
      await tx.chairEvent.create({
        data: {
          chairId: chair.id,
          eventType: 'START_CONFIRMED',
          fromStatus: 'MAYBE_ACTIVE',
          toStatus: 'ACTIVE',
          powerWatts,
          createdAt: now,
        },
        select: { id: true },
      });
      await tx.chairEvent.create({
        data: {
          chairId: chair.id,
          sessionId: s.id,
          eventType: 'SESSION_STARTED',
          toStatus: 'ACTIVE',
          powerWatts,
          message: anomalyType === 'NO_OPEN_SHIFT' ? 'Started with no open shift' : null,
          createdAt: now,
        },
        select: { id: true },
      });
      return s;
    });

    chair.status = 'ACTIVE';
    chair.maybeActiveSince = null;
    chair.stateChangedAt = now;
    bindSessionMem(chair, {
      id: session.id,
      startedAt: session.startedAt,
      anomalyType: session.anomalyType,
      startPower: powerWatts,
    });

    if (anomalyType === 'NO_OPEN_SHIFT') {
      logger.warn(`[state-machine] ${chair.name}: session ${session.id.slice(-8)} started — NO_OPEN_SHIFT`);
    } else {
      logger.info(`[state-machine] ${chair.name}: session ${session.id.slice(-8)} STARTED`);
    }
  }

  private async _endSession(chair: ChairMem, powerWatts: number, now: Date): Promise<void> {
    const session = chair.session;
    if (!session) {
      logger.warn(`[state-machine] ${chair.name}: MAYBE_FINISHED but no session — recovering to IDLE`);
      chair.status = 'IDLE';
      chair.currentSessionId = null;
      chair.maybeFinishedSince = null;
      chair.stateChangedAt = now;
      lastTickDbWrites += 1;
      usageMetrics.incr('dbWrites');
      await prisma.chair.update({
        where: { id: chair.id },
        data: {
          status: 'IDLE',
          currentSessionId: null,
          maybeFinishedSince: null,
          stateChangedAt: now,
        },
        select: { id: true },
      });
      return;
    }

    const maybeFinishedSince = chair.maybeFinishedSince!;
    const durationSeconds = Math.max(
      0,
      Math.floor((maybeFinishedSince.getTime() - session.startedAt.getTime()) / 1000),
    );

    const pricing = await pricingService.calculateSessionPrice(durationSeconds);
    const mergedAnomalyType = mergeAnomalyTypes(session.anomalyType, pricing.anomalyType);

    const avg =
      session.power.count > 0
        ? Math.round((session.power.sum / session.power.count) * 100) / 100
        : powerWatts;

    lastTickDbWrites += 4;
    usageMetrics.incr('dbWrites', 4);
    await prisma.$transaction(async (tx) => {
      await tx.chairSession.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED',
          billingStatus: pricing.billingStatus,
          anomalyType: mergedAnomalyType,
          lowPowerDetectedAt: maybeFinishedSince,
          confirmedEndAt: now,
          endedAt: maybeFinishedSince,
          durationSeconds,
          endPowerWatts: powerWatts,
          minPowerWatts: session.power.min,
          maxPowerWatts: session.power.max,
          avgPowerWatts: avg,
          matchedPlanId: pricing.matchedPlanId,
          expectedAmount: pricing.expectedAmount,
          pricingSnapshot: pricing.pricingSnapshot as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await tx.chair.update({
        where: { id: chair.id },
        data: {
          status: 'IDLE',
          currentSessionId: null,
          maybeFinishedSince: null,
          maybeActiveSince: null,
          stateChangedAt: now,
          currentPowerWatts: powerWatts,
          isOnline: true,
          lastSyncedAt: now,
        },
        select: { id: true },
      });
      await tx.chairEvent.create({
        data: {
          chairId: chair.id,
          sessionId: session.id,
          eventType: 'END_CONFIRMED',
          fromStatus: 'MAYBE_FINISHED',
          toStatus: 'IDLE',
          powerWatts,
          createdAt: now,
        },
        select: { id: true },
      });
      await tx.chairEvent.create({
        data: {
          chairId: chair.id,
          sessionId: session.id,
          eventType: 'SESSION_FINISHED',
          toStatus: 'IDLE',
          message: `${durationSeconds}s → ${pricing.expectedAmount} MAD${mergedAnomalyType ? ` [${mergedAnomalyType}]` : ''}`,
          createdAt: now,
        },
        select: { id: true },
      });

      await syncSessionCashLedgerInTx(tx, {
        sessionId: session.id,
        previousCorrectedAmount: null,
        previousExpectedAmount: null,
        newCorrectedAmount: null,
        newExpectedAmount: pricing.expectedAmount,
        sessionFinancialAt: maybeFinishedSince,
      });
    });

    chair.status = 'IDLE';
    chair.maybeFinishedSince = null;
    chair.maybeActiveSince = null;
    chair.stateChangedAt = now;
    clearSessionMem(chair);

    logger.info(
      `[state-machine] ${chair.name}: session ${session.id.slice(-8)} FINISHED` +
        ` (${durationSeconds}s, ${pricing.expectedAmount} MAD, ${pricing.billingStatus}` +
        `${mergedAnomalyType ? `, anomaly=${mergedAnomalyType}` : ''})`,
    );
  }

  private async _handleOffline(chair: ChairMem, now: Date): Promise<void> {
    const prev = chair.status;
    chair.statusBeforeOffline = prev;
    chair.status = 'OFFLINE';
    chair.offlineSince = now;
    chair.isOnline = false;
    chair.lastSyncedAt = now;
    lastTickDbWrites += 2;
    usageMetrics.incr('dbWrites', 2);
    await prisma.chair.update({
      where: { id: chair.id },
      data: {
        status: 'OFFLINE',
        statusBeforeOffline: prev,
        offlineSince: now,
        isOnline: false,
        lastSyncedAt: now,
      },
      select: { id: true },
    });
    await this._event(chair.id, null, 'DEVICE_OFFLINE', prev, 'OFFLINE', null, null, now);
    logger.info(`[state-machine] ${chair.name}: → OFFLINE (was ${prev})`);
  }

  private async _handleOnlineRecovery(chair: ChairMem, now: Date): Promise<void> {
    usageMetrics.incr('dbReads');
    lastTickDbWrites += 1;
    const activeSession = await prisma.chairSession.findFirst({
      where: { chairId: chair.id, status: 'ACTIVE' },
      select: {
        id: true,
        startedAt: true,
        anomalyType: true,
        startPowerWatts: true,
        minPowerWatts: true,
      },
    });
    const restored: ChairStatus = activeSession ? 'ACTIVE' : 'IDLE';

    chair.status = restored;
    chair.isOnline = true;
    chair.lastOnlineAt = now;
    chair.offlineSince = null;
    chair.statusBeforeOffline = null;
    chair.currentSessionId = activeSession?.id ?? null;
    if (activeSession) {
      bindSessionMem(chair, {
        id: activeSession.id,
        startedAt: activeSession.startedAt,
        anomalyType: activeSession.anomalyType,
        startPower: activeSession.startPowerWatts ?? activeSession.minPowerWatts ?? 0,
      });
    } else {
      clearSessionMem(chair);
    }

    lastTickDbWrites += 2;
    usageMetrics.incr('dbWrites', 2);
    await prisma.chair.update({
      where: { id: chair.id },
      data: {
        status: restored,
        isOnline: true,
        lastOnlineAt: now,
        offlineSince: null,
        statusBeforeOffline: null,
        currentSessionId: activeSession?.id ?? null,
      },
      select: { id: true },
    });
    await this._event(
      chair.id,
      activeSession?.id ?? null,
      'DEVICE_ONLINE',
      'OFFLINE',
      restored,
      null,
      null,
      now,
    );
    logger.info(`[state-machine] ${chair.name}: OFFLINE → ${restored} (recovered)`);
  }

  private async _event(
    chairId: string,
    sessionId: string | null,
    eventType: string,
    fromStatus: string | null,
    toStatus: string | null,
    powerWatts: number | null,
    message: string | null,
    createdAt: Date,
  ): Promise<void> {
    usageMetrics.incr('dbWrites');
    await prisma.chairEvent.create({
      data: {
        chairId,
        sessionId,
        eventType,
        fromStatus: fromStatus as ChairStatus | null,
        toStatus: toStatus as ChairStatus | null,
        powerWatts,
        message,
        createdAt,
      },
      select: { id: true },
    });
  }
}

export const chairStateService = new ChairStateService();

export { transitionNeedsDbWrite, decideTransition } from './chair-state.logic';
