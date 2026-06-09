import { Prisma } from '@prisma/client';
import type { ChairDetectionConfig, ChairSession, ChairStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { pricingService } from '../pricing/pricing.service';
import type { PowerReading } from './chair.types';

// ── Internal types ─────────────────────────────────────────────────────────────

type ChairWithConfig = Prisma.ChairGetPayload<{
  include: { detectionConfigs: true };
}>;

interface DetectionConfig {
  id: string;
  startThresholdWatts: number;
  stopThresholdWatts: number;
  startConfirmSeconds: number;
  stopConfirmSeconds: number;
  activationDelaySeconds: number;
  baselinePowerWatts: number | null;
}

interface EffectiveConfig extends DetectionConfig {
  // TODO: production ignores effectiveXxx overrides — these fields equal the DB values.
  // Only the simulation sets them to shorter durations via SIMULATION_FAST_MODE.
  effectiveStartConfirmSeconds: number;
  effectiveStopConfirmSeconds: number;
}

// Safe defaults used when a chair has no active detection config.
const FALLBACK_CONFIG: DetectionConfig = {
  id: 'fallback',
  startThresholdWatts: 7,
  stopThresholdWatts: 5,
  startConfirmSeconds: 30,
  stopConfirmSeconds: 180,
  activationDelaySeconds: 30,
  baselinePowerWatts: 2.1,
};

// ── Service ────────────────────────────────────────────────────────────────────

export class ChairStateService {
  async processChairReading(chairId: string, reading: PowerReading): Promise<void> {
    const now = reading.recordedAt ?? new Date();

    const chair = await prisma.chair.findUnique({
      where: { id: chairId },
      include: {
        detectionConfigs: { where: { isActive: true }, take: 1 },
      },
    });

    if (!chair) {
      logger.warn(`[state-machine] Chair ${chairId} not found`);
      return;
    }
    if (!chair.isEnabled) return;
    // MAINTENANCE and ERROR states are only changed by explicit admin actions.
    if (chair.status === 'MAINTENANCE' || chair.status === 'ERROR') return;

    const rawCfg: ChairDetectionConfig | undefined = chair.detectionConfigs[0];
    if (!rawCfg) {
      logger.warn(`[state-machine] ${chair.name}: no active detection config — using defaults`);
    }

    const config: DetectionConfig = rawCfg
      ? {
          id: rawCfg.id,
          startThresholdWatts: rawCfg.startThresholdWatts,
          stopThresholdWatts: rawCfg.stopThresholdWatts,
          startConfirmSeconds: rawCfg.startConfirmSeconds,
          stopConfirmSeconds: rawCfg.stopConfirmSeconds,
          activationDelaySeconds: rawCfg.activationDelaySeconds,
          baselinePowerWatts: rawCfg.baselinePowerWatts,
        }
      : FALLBACK_CONFIG;

    // TODO: production removes SIMULATION_FAST_MODE branch — always uses DB config values.
    const effective: EffectiveConfig = {
      ...config,
      effectiveStartConfirmSeconds: env.SIMULATION_FAST_MODE ? 5 : config.startConfirmSeconds,
      effectiveStopConfirmSeconds: env.SIMULATION_FAST_MODE ? 10 : config.stopConfirmSeconds,
    };

    // ── Offline handling ───────────────────────────────────────────────────────
    if (!reading.isOnline) {
      if (chair.status !== 'OFFLINE') {
        await this._handleOffline(chair, now);
      }
      return;
    }

    // ── Online recovery from OFFLINE ──────────────────────────────────────────
    let currentStatus: ChairStatus = chair.status;
    if (currentStatus === 'OFFLINE') {
      currentStatus = await this._handleOnlineRecovery(chair, now);
    }

    // ── Update live-state fields on the chair row ──────────────────────────────
    const liveData: Prisma.ChairUpdateInput = {
      currentPowerWatts: reading.powerWatts,
      isOnline: true,
      lastSyncedAt: now,
      lastOnlineAt: now,
    };
    if (reading.relayIsOn !== undefined) liveData.relayIsOn = reading.relayIsOn;
    await prisma.chair.update({ where: { id: chairId }, data: liveData });

    // ── State machine ──────────────────────────────────────────────────────────
    switch (currentStatus) {
      case 'IDLE':
        await this._processIdle(chair, reading.powerWatts, effective, now);
        break;
      case 'MAYBE_ACTIVE':
        await this._processMaybeActive(chair, reading.powerWatts, effective, now);
        break;
      case 'ACTIVE':
        await this._processActive(chair, reading.powerWatts, effective, now);
        break;
      case 'MAYBE_FINISHED':
        await this._processMaybeFinished(chair, reading.powerWatts, effective, now);
        break;
      default:
        break;
    }
  }

  // ── State handlers ─────────────────────────────────────────────────────────

  private async _processIdle(
    chair: ChairWithConfig,
    powerWatts: number,
    cfg: EffectiveConfig,
    now: Date,
  ): Promise<void> {
    if (powerWatts >= cfg.startThresholdWatts) {
      await prisma.chair.update({
        where: { id: chair.id },
        data: { status: 'MAYBE_ACTIVE', maybeActiveSince: now, stateChangedAt: now },
      });
      await this._event(chair.id, null, 'START_DETECTED', 'IDLE', 'MAYBE_ACTIVE', powerWatts, null, now);
      logger.info(`[state-machine] ${chair.name}: IDLE → MAYBE_ACTIVE (${powerWatts.toFixed(1)}W)`);
    }
  }

  private async _processMaybeActive(
    chair: ChairWithConfig,
    powerWatts: number,
    cfg: EffectiveConfig,
    now: Date,
  ): Promise<void> {
    if (powerWatts < cfg.startThresholdWatts) {
      await prisma.chair.update({
        where: { id: chair.id },
        data: { status: 'IDLE', maybeActiveSince: null, stateChangedAt: now },
      });
      await this._event(chair.id, null, 'START_CANCELLED', 'MAYBE_ACTIVE', 'IDLE', powerWatts, null, now);
      logger.info(`[state-machine] ${chair.name}: MAYBE_ACTIVE → IDLE (power dropped ${powerWatts.toFixed(1)}W)`);
      return;
    }

    const elapsed = (now.getTime() - chair.maybeActiveSince!.getTime()) / 1000;
    if (elapsed >= cfg.effectiveStartConfirmSeconds) {
      await this._startSession(chair, powerWatts, cfg, now);
    }
  }

  private async _processActive(
    chair: ChairWithConfig,
    powerWatts: number,
    cfg: EffectiveConfig,
    now: Date,
  ): Promise<void> {
    const session = await this._findActiveSession(chair.id, chair.currentSessionId);

    if (!session) {
      logger.warn(`[state-machine] ${chair.name}: ACTIVE but no session found — recovering to IDLE`);
      await prisma.chair.update({
        where: { id: chair.id },
        data: { status: 'IDLE', currentSessionId: null, stateChangedAt: now },
      });
      return;
    }

    const newMin = Math.min(session.minPowerWatts ?? powerWatts, powerWatts);
    const newMax = Math.max(session.maxPowerWatts ?? powerWatts, powerWatts);

    if (powerWatts <= cfg.stopThresholdWatts) {
      await prisma.$transaction(async (tx) => {
        await tx.chairSession.update({
          where: { id: session.id },
          data: { minPowerWatts: newMin, maxPowerWatts: newMax },
        });
        await tx.chair.update({
          where: { id: chair.id },
          data: { status: 'MAYBE_FINISHED', maybeFinishedSince: now, stateChangedAt: now },
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
        });
      });
      logger.info(
        `[state-machine] ${chair.name}: ACTIVE → MAYBE_FINISHED (${powerWatts.toFixed(1)}W ≤ ${cfg.stopThresholdWatts}W)`,
      );
    } else if (newMin !== (session.minPowerWatts ?? powerWatts) || newMax !== (session.maxPowerWatts ?? powerWatts)) {
      await prisma.chairSession.update({
        where: { id: session.id },
        data: { minPowerWatts: newMin, maxPowerWatts: newMax },
      });
    }
  }

  private async _processMaybeFinished(
    chair: ChairWithConfig,
    powerWatts: number,
    cfg: EffectiveConfig,
    now: Date,
  ): Promise<void> {
    const session = await this._findActiveSession(chair.id, chair.currentSessionId);

    if (!session) {
      logger.warn(`[state-machine] ${chair.name}: MAYBE_FINISHED but no session — recovering to IDLE`);
      await prisma.chair.update({
        where: { id: chair.id },
        data: { status: 'IDLE', currentSessionId: null, maybeFinishedSince: null, stateChangedAt: now },
      });
      return;
    }

    if (powerWatts > cfg.stopThresholdWatts) {
      await prisma.chair.update({
        where: { id: chair.id },
        data: { status: 'ACTIVE', maybeFinishedSince: null, stateChangedAt: now },
      });
      await this._event(chair.id, session.id, 'POWER_RECOVERED', 'MAYBE_FINISHED', 'ACTIVE', powerWatts, null, now);
      logger.info(`[state-machine] ${chair.name}: MAYBE_FINISHED → ACTIVE (recovered ${powerWatts.toFixed(1)}W)`);
      return;
    }

    const elapsed = (now.getTime() - chair.maybeFinishedSince!.getTime()) / 1000;
    if (elapsed >= cfg.effectiveStopConfirmSeconds) {
      await this._endSession(chair, session, powerWatts, now);
    }
  }

  // ── Session lifecycle ───────────────────────────────────────────────────────

  private async _startSession(
    chair: ChairWithConfig,
    powerWatts: number,
    cfg: EffectiveConfig,
    now: Date,
  ): Promise<void> {
    const maybeActiveSince = chair.maybeActiveSince!;

    // Guard: never create a second ACTIVE session for the same chair
    const existing = await prisma.chairSession.findFirst({
      where: { chairId: chair.id, status: 'ACTIVE' },
    });
    if (existing) {
      logger.warn(`[state-machine] ${chair.name}: active session already exists — correcting chair state`);
      await prisma.chair.update({
        where: { id: chair.id },
        data: { status: 'ACTIVE', currentSessionId: existing.id, maybeActiveSince: null, stateChangedAt: now },
      });
      return;
    }

    const openShift = await prisma.shift.findFirst({
      where: { status: 'OPEN' },
      orderBy: { startedAt: 'desc' },
    });
    const anomalyType: string | null = openShift ? null : 'NO_OPEN_SHIFT';

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
      });
      await tx.chair.update({
        where: { id: chair.id },
        data: { status: 'ACTIVE', currentSessionId: s.id, maybeActiveSince: null, stateChangedAt: now },
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
      });
      return s;
    });

    if (anomalyType === 'NO_OPEN_SHIFT') {
      logger.warn(`[state-machine] ${chair.name}: session ${session.id.slice(-8)} started — NO_OPEN_SHIFT`);
    } else {
      logger.info(`[state-machine] ${chair.name}: session ${session.id.slice(-8)} STARTED`);
    }
  }

  private async _endSession(
    chair: ChairWithConfig,
    session: ChairSession,
    powerWatts: number,
    now: Date,
  ): Promise<void> {
    const maybeFinishedSince = chair.maybeFinishedSince!;
    const durationSeconds = Math.max(
      0,
      Math.floor((maybeFinishedSince.getTime() - session.startedAt.getTime()) / 1000),
    );

    const pricing = await pricingService.calculateSessionPrice(durationSeconds);

    await prisma.$transaction(async (tx) => {
      await tx.chairSession.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED',
          billingStatus: pricing.matchedPlanId ? 'CALCULATED' : 'PENDING',
          lowPowerDetectedAt: maybeFinishedSince,
          confirmedEndAt: now,
          endedAt: maybeFinishedSince,
          durationSeconds,
          endPowerWatts: powerWatts,
          matchedPlanId: pricing.matchedPlanId,
          expectedAmount: pricing.expectedAmount,
          pricingSnapshot: pricing.pricingSnapshot as Prisma.InputJsonValue,
        },
      });
      await tx.chair.update({
        where: { id: chair.id },
        data: {
          status: 'IDLE',
          currentSessionId: null,
          maybeFinishedSince: null,
          maybeActiveSince: null,
          stateChangedAt: now,
        },
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
      });
      await tx.chairEvent.create({
        data: {
          chairId: chair.id,
          sessionId: session.id,
          eventType: 'SESSION_FINISHED',
          toStatus: 'IDLE',
          message: `${durationSeconds}s → ${pricing.expectedAmount} MAD`,
          createdAt: now,
        },
      });
    });

    logger.info(
      `[state-machine] ${chair.name}: session ${session.id.slice(-8)} FINISHED (${durationSeconds}s, ${pricing.expectedAmount} MAD)`,
    );
  }

  // ── Offline / recovery ──────────────────────────────────────────────────────

  private async _handleOffline(chair: ChairWithConfig, now: Date): Promise<void> {
    await prisma.chair.update({
      where: { id: chair.id },
      data: {
        status: 'OFFLINE',
        statusBeforeOffline: chair.status,
        offlineSince: now,
        isOnline: false,
        lastSyncedAt: now,
      },
    });
    await this._event(chair.id, null, 'DEVICE_OFFLINE', chair.status, 'OFFLINE', null, null, now);
    logger.info(`[state-machine] ${chair.name}: → OFFLINE (was ${chair.status})`);
  }

  private async _handleOnlineRecovery(chair: ChairWithConfig, now: Date): Promise<ChairStatus> {
    const activeSession = await prisma.chairSession.findFirst({
      where: { chairId: chair.id, status: 'ACTIVE' },
    });
    const restored: ChairStatus = activeSession ? 'ACTIVE' : 'IDLE';

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
    });
    await this._event(chair.id, activeSession?.id ?? null, 'DEVICE_ONLINE', 'OFFLINE', restored, null, null, now);
    logger.info(`[state-machine] ${chair.name}: OFFLINE → ${restored} (recovered)`);
    return restored;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async _findActiveSession(
    chairId: string,
    currentSessionId: string | null,
  ): Promise<ChairSession | null> {
    if (currentSessionId) {
      const s = await prisma.chairSession.findFirst({
        where: { id: currentSessionId, status: 'ACTIVE' },
      });
      if (s) return s;
    }
    // Recovery path: scan by chair
    return prisma.chairSession.findFirst({
      where: { chairId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
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
    });
  }
}

export const chairStateService = new ChairStateService();
