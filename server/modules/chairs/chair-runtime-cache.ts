/**
 * In-memory chair + active-session state for Shelly polling.
 * Hydrated once, reconciled periodically — ticks do not hit the DB by default.
 */

import type { ChairStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import { usageMetrics } from '../../utils/usage-metrics';
import {
  createPowerAgg,
  recordPowerSample,
  powerAggAverage,
  type PowerAgg,
} from './chair-state.logic';
import type { StartBlockReason } from './chair-no-shift-block.logic';

export interface DetectionConfigMem {
  id: string;
  startThresholdWatts: number;
  stopThresholdWatts: number;
  startConfirmSeconds: number;
  stopConfirmSeconds: number;
  activationDelaySeconds: number;
  baselinePowerWatts: number | null;
}

export interface SessionMem {
  id: string;
  startedAt: Date;
  anomalyType: string | null;
  power: PowerAgg;
  dirtyMetrics: boolean;
}

export interface ChairMem {
  id: string;
  name: string;
  displayName: string | null;
  isEnabled: boolean;
  status: ChairStatus;
  isOnline: boolean;
  currentPowerWatts: number | null;
  relayIsOn: boolean | null;
  currentSessionId: string | null;
  maybeActiveSince: Date | null;
  maybeFinishedSince: Date | null;
  stateChangedAt: Date | null;
  statusBeforeOffline: ChairStatus | null;
  offlineSince: Date | null;
  lastOnlineAt: Date | null;
  lastSyncedAt: Date | null;
  config: DetectionConfigMem;
  session: SessionMem | null;
  /** Live fields changed since last DB flush (power / online / lastSynced). */
  dirtyLive: boolean;
  /** In-memory only: suppress repeated start debounce while shift attribution is blocked. */
  startBlockReason: StartBlockReason | null;
}

const FALLBACK_CONFIG: DetectionConfigMem = {
  id: 'fallback',
  startThresholdWatts: 7,
  stopThresholdWatts: 5,
  startConfirmSeconds: 30,
  stopConfirmSeconds: 180,
  activationDelaySeconds: 30,
  baselinePowerWatts: 2.1,
};

const chairsById = new Map<string, ChairMem>();
let hydrated = false;
let lastReconcileAt: Date | null = null;
let lastPowerFlushAt: Date | null = null;

export function isRuntimeHydrated(): boolean {
  return hydrated;
}

export function getChairMem(chairId: string): ChairMem | undefined {
  return chairsById.get(chairId);
}

export function getAllChairMem(): ChairMem[] {
  return Array.from(chairsById.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertChairMem(chair: ChairMem): void {
  chairsById.set(chair.id, chair);
}

export function clearRuntimeCache(): void {
  chairsById.clear();
  hydrated = false;
  lastReconcileAt = null;
  lastPowerFlushAt = null;
}

function mapConfig(
  raw: {
    id: string;
    startThresholdWatts: number;
    stopThresholdWatts: number;
    startConfirmSeconds: number;
    stopConfirmSeconds: number;
    activationDelaySeconds: number;
    baselinePowerWatts: number | null;
  } | undefined,
): DetectionConfigMem {
  if (!raw) return { ...FALLBACK_CONFIG };
  return {
    id: raw.id,
    startThresholdWatts: raw.startThresholdWatts,
    stopThresholdWatts: raw.stopThresholdWatts,
    startConfirmSeconds: raw.startConfirmSeconds,
    stopConfirmSeconds: raw.stopConfirmSeconds,
    activationDelaySeconds: raw.activationDelaySeconds,
    baselinePowerWatts: raw.baselinePowerWatts,
  };
}

/** Load all enabled chairs + active sessions into memory. */
export async function hydrateRuntimeCache(): Promise<void> {
  usageMetrics.incr('dbReads');
  const rows = await prisma.chair.findMany({
    where: { isEnabled: true },
    orderBy: { name: 'asc' },
    include: {
      detectionConfigs: { where: { isActive: true }, take: 1 },
      sessions: {
        where: { status: 'ACTIVE' },
        take: 1,
        orderBy: { startedAt: 'desc' },
      },
    },
  });

  chairsById.clear();
  for (const c of rows) {
    const active = c.sessions[0] ?? null;
    const mem: ChairMem = {
      id: c.id,
      name: c.name,
      displayName: c.displayName,
      isEnabled: c.isEnabled,
      status: c.status,
      isOnline: c.isOnline,
      currentPowerWatts: c.currentPowerWatts,
      relayIsOn: c.relayIsOn,
      currentSessionId: c.currentSessionId ?? active?.id ?? null,
      maybeActiveSince: c.maybeActiveSince,
      maybeFinishedSince: c.maybeFinishedSince,
      stateChangedAt: c.stateChangedAt,
      statusBeforeOffline: c.statusBeforeOffline,
      offlineSince: c.offlineSince,
      lastOnlineAt: c.lastOnlineAt,
      lastSyncedAt: c.lastSyncedAt,
      config: mapConfig(c.detectionConfigs[0]),
      session: active
        ? {
            id: active.id,
            startedAt: active.startedAt,
            anomalyType: active.anomalyType,
            power: createPowerAgg(
              active.minPowerWatts ?? active.startPowerWatts ?? undefined,
            ),
            dirtyMetrics: false,
          }
        : null,
      dirtyLive: false,
      startBlockReason: null,
    };
    // Seed max from DB if present
    if (mem.session && active) {
      if (active.maxPowerWatts != null) {
        mem.session.power.max = Math.max(mem.session.power.max ?? 0, active.maxPowerWatts);
      }
      if (active.minPowerWatts != null) {
        mem.session.power.min = Math.min(mem.session.power.min ?? active.minPowerWatts, active.minPowerWatts);
      }
    }
    chairsById.set(c.id, mem);
  }

  hydrated = true;
  lastReconcileAt = new Date();
  logger.info(`[chair-runtime] Hydrated ${chairsById.size} chairs into memory`);
}

/**
 * Safety reconcile: reload from DB and flush dirty live/metrics.
 * Call at most once per SHELLY_DB_RECONCILE_INTERVAL_MS.
 */
export async function reconcileRuntimeFromDb(): Promise<void> {
  await flushDirtyLiveState();
  await flushPowerMetrics();
  await hydrateRuntimeCache();
  usageMetrics.incr('dbReconciliations');
  lastReconcileAt = new Date();
}

export function getLastReconcileAt(): Date | null {
  return lastReconcileAt;
}

export function getLastPowerFlushAt(): Date | null {
  return lastPowerFlushAt;
}

/** Apply a power sample to the in-memory session aggregator. */
export function sampleSessionPower(chair: ChairMem, watts: number): void {
  if (!chair.session) return;
  chair.session.power = recordPowerSample(chair.session.power, watts);
  chair.session.dirtyMetrics = true;
}

/** Persist dirty live chair fields (power, online, lastSynced) in one batch. */
export async function flushDirtyLiveState(): Promise<number> {
  const dirty = getAllChairMem().filter((c) => c.dirtyLive);
  if (dirty.length === 0) return 0;

  usageMetrics.incr('dbWrites', dirty.length);
  await prisma.$transaction(
    dirty.map((c) =>
      prisma.chair.update({
        where: { id: c.id },
        data: {
          currentPowerWatts: c.currentPowerWatts,
          isOnline: c.isOnline,
          relayIsOn: c.relayIsOn,
          lastSyncedAt: c.lastSyncedAt,
          lastOnlineAt: c.lastOnlineAt,
        },
        select: { id: true },
      }),
    ),
  );
  for (const c of dirty) c.dirtyLive = false;
  return dirty.length;
}

/** Persist aggregated min/max/avg for active sessions (at most once per flush interval). */
export async function flushPowerMetrics(): Promise<number> {
  const dirtySessions = getAllChairMem().filter((c) => c.session?.dirtyMetrics);
  if (dirtySessions.length === 0) return 0;

  usageMetrics.incr('dbWrites', dirtySessions.length);
  usageMetrics.incr('powerFlushes', dirtySessions.length);

  await prisma.$transaction(
    dirtySessions.map((c) => {
      const s = c.session!;
      return prisma.chairSession.update({
        where: { id: s.id },
        data: {
          minPowerWatts: s.power.min,
          maxPowerWatts: s.power.max,
          avgPowerWatts: powerAggAverage(s.power),
        },
        select: { id: true },
      });
    }),
  );

  for (const c of dirtySessions) {
    if (c.session) c.session.dirtyMetrics = false;
  }
  lastPowerFlushAt = new Date();
  return dirtySessions.length;
}

/** Attach a newly created session to memory. */
export function bindSessionMem(
  chair: ChairMem,
  session: { id: string; startedAt: Date; anomalyType: string | null; startPower: number },
): void {
  chair.currentSessionId = session.id;
  chair.session = {
    id: session.id,
    startedAt: session.startedAt,
    anomalyType: session.anomalyType,
    power: createPowerAgg(session.startPower),
    dirtyMetrics: false,
  };
}

export function clearSessionMem(chair: ChairMem): void {
  chair.currentSessionId = null;
  chair.session = null;
}

/** After a shop-wide OPEN shift is created, allow blocked chairs to start normally on next poll. */
export function clearNoShiftStartBlocks(): number {
  let cleared = 0;
  for (const chair of chairsById.values()) {
    if (chair.startBlockReason != null) {
      chair.startBlockReason = null;
      cleared++;
    }
  }
  if (cleared > 0) {
    logger.info(`[chair-runtime] Cleared no-shift start block on ${cleared} chair(s)`);
  }
  return cleared;
}

export { FALLBACK_CONFIG };
