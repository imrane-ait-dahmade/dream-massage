// Background job: fetches live power readings from Shelly Cloud and feeds them into
// the in-memory chair state machine. DB is touched only on real transitions,
// periodic reconcile, or power-metrics flush — never on every tick by default.

import { env } from '../config/env';
import { logger } from '../utils/logger';
import { usageMetrics } from '../utils/usage-metrics';
import { allowDbAttempt, recordDbFailure, isTemporaryDbError } from '../utils/db-circuit-breaker';
import { shellyService, isShellyConfigured } from '../modules/shelly/shelly.service';
import { chairStateService } from '../modules/chairs/chair-state.service';
import { transitionNeedsDbWrite } from '../modules/chairs/chair-state.logic';
import { dashboardService } from '../modules/dashboard/dashboard.service';
import { homeDashboardService } from '../modules/dashboard/home-dashboard.service';
import {
  hydrateRuntimeCache,
  isRuntimeHydrated,
  reconcileRuntimeFromDb,
  flushDirtyLiveState,
  flushPowerMetrics,
  getLastReconcileAt,
  getLastPowerFlushAt,
  getAllChairMem,
  clearRuntimeCache,
} from '../modules/chairs/chair-runtime-cache';

type ChairIdMap = Record<string, string>; // chairName → DB id

let chairIdCache: ChairIdMap | null = null;
let lastSyncAt: Date | null = null;
let consecutiveErrors = 0;
let lastTransitionAt: Date | null = null;
let lastTickHadTransition = false;
const MAX_CONSECUTIVE_LOG = 5;

// Process-level singleton guard for reconcile/flush timers owned by realtime job
let shellyWorkerLock = false;

export function acquireShellyWorkerLock(): boolean {
  if (shellyWorkerLock) return false;
  shellyWorkerLock = true;
  return true;
}

export function releaseShellyWorkerLock(): void {
  shellyWorkerLock = false;
}

export function isShellyWorkerLocked(): boolean {
  return shellyWorkerLock;
}

async function loadChairIds(): Promise<ChairIdMap> {
  if (chairIdCache) return chairIdCache;
  if (!isRuntimeHydrated()) {
    await hydrateRuntimeCache();
  }
  chairIdCache = Object.fromEntries(getAllChairMem().map((c) => [c.name, c.id]));
  logger.info(`[shelly-sync] Chair ID map loaded: ${Object.keys(chairIdCache).join(', ')}`);
  return chairIdCache;
}

/**
 * Process one Shelly sync tick (memory-first).
 * Returns whether any business transition occurred (for Socket.IO broadcast).
 */
export async function processShellySyncTick(): Promise<{ hadTransition: boolean }> {
  if (!isShellyConfigured()) {
    logger.warn('[shelly-sync] Shelly not configured — cannot poll real devices');
    return { hadTransition: false };
  }

  usageMetrics.incr('shellyTicks');

  if (!isRuntimeHydrated()) {
    if (!allowDbAttempt()) {
      usageMetrics.incr('retriesBlocked');
      return { hadTransition: false };
    }
    await hydrateRuntimeCache();
  }

  // Periodic DB reconcile (safety) — max once per SHELLY_DB_RECONCILE_INTERVAL_MS
  const nowMs = Date.now();
  const lastRec = getLastReconcileAt()?.getTime() ?? 0;
  if (nowMs - lastRec >= env.SHELLY_DB_RECONCILE_INTERVAL_MS) {
    if (allowDbAttempt()) {
      try {
        await reconcileRuntimeFromDb();
        chairIdCache = null; // refresh name→id after reconcile
      } catch (err) {
        if (isTemporaryDbError(err)) recordDbFailure(err, (l) => logger.error(l));
        else throw err;
      }
    }
  }

  // Periodic power metrics flush
  const lastFlush = getLastPowerFlushAt()?.getTime() ?? 0;
  if (nowMs - lastFlush >= env.POWER_METRICS_FLUSH_INTERVAL_MS) {
    if (allowDbAttempt()) {
      try {
        await flushPowerMetrics();
        await flushDirtyLiveState();
      } catch (err) {
        if (isTemporaryDbError(err)) recordDbFailure(err, (l) => logger.error(l));
        else throw err;
      }
    }
  }

  const ids = await loadChairIds();
  const readings = await shellyService.fetchDeviceStates();
  const now = new Date();
  let hadTransition = false;

  for (const reading of readings) {
    const chairId = ids[reading.chairName];
    if (!chairId) {
      logger.warn(`[shelly-sync] Chair ${reading.chairName} not found in memory/DB`);
      continue;
    }
    try {
      const kind = await chairStateService.processChairReading(chairId, {
        powerWatts: reading.powerWatts,
        isOnline: reading.isOnline,
        relayIsOn: reading.relayIsOn,
        recordedAt: now,
      });
      if (transitionNeedsDbWrite(kind)) {
        hadTransition = true;
        lastTransitionAt = now;
        dashboardService.invalidateCache();
        homeDashboardService.invalidateCache();
      }
    } catch (err) {
      if (isTemporaryDbError(err)) {
        recordDbFailure(err, (l) => logger.error(l));
      } else {
        logger.error(`[shelly-sync] State machine error for ${reading.chairName}: ${String(err)}`);
      }
    }
  }

  lastSyncAt = now;
  lastTickHadTransition = hadTransition;
  consecutiveErrors = 0;
  return { hadTransition };
}

/**
 * Wrapper that suppresses log spam for repeated network errors.
 */
export async function tryShellySyncTick(): Promise<{ ok: boolean; hadTransition: boolean }> {
  try {
    const result = await processShellySyncTick();
    return { ok: true, hadTransition: result.hadTransition };
  } catch (err) {
    consecutiveErrors++;
    if (isTemporaryDbError(err)) {
      recordDbFailure(err, (l) => logger.error(l));
    }
    if (consecutiveErrors === 1 || consecutiveErrors % MAX_CONSECUTIVE_LOG === 0) {
      logger.error(
        `[shelly-sync] Tick failed (${consecutiveErrors} consecutive): ${String(err)}`,
      );
    }
    return { ok: false, hadTransition: false };
  }
}

export function getLastShellySyncAt(): Date | null {
  return lastSyncAt;
}

export function getLastTransitionAt(): Date | null {
  return lastTransitionAt;
}

export function didLastTickHaveTransition(): boolean {
  return lastTickHadTransition;
}

/** Invalidate the chair ID cache (e.g. after chair config changes). */
export function resetShellyChairIdCache(): void {
  chairIdCache = null;
  clearRuntimeCache();
}
