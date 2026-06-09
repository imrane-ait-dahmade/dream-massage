// Background job: fetches live power readings from Shelly Cloud and feeds them into
// the chair state machine. Runs each tick when SIMULATION_ENABLED=false.
// All 5 chairs are fetched in ONE HTTP request.

import { prisma } from '../prisma';
import { logger } from '../utils/logger';
import { shellyService, isShellyConfigured } from '../modules/shelly/shelly.service';
import { chairStateService } from '../modules/chairs/chair-state.service';

type ChairIdMap = Record<string, string>; // chairName → DB id

let chairIdCache: ChairIdMap | null = null;
let lastSyncAt: Date | null = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_LOG = 5; // only log repeated errors every N times

async function loadChairIds(): Promise<ChairIdMap> {
  if (chairIdCache) return chairIdCache;
  const chairs = await prisma.chair.findMany({
    where: { isEnabled: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  chairIdCache = Object.fromEntries(chairs.map((c) => [c.name, c.id]));
  logger.info(`[shelly-sync] Chair ID map loaded: ${Object.keys(chairIdCache).join(', ')}`);
  return chairIdCache;
}

/**
 * Process one Shelly sync tick.
 * Fetches all devices, processes each reading through the state machine.
 * Called by the realtime job before each dashboard broadcast.
 */
export async function processShellySyncTick(): Promise<void> {
  if (!isShellyConfigured()) {
    logger.warn('[shelly-sync] Shelly not configured — cannot poll real devices');
    return;
  }

  const ids = await loadChairIds();
  const readings = await shellyService.fetchDeviceStates();
  const now = new Date();

  for (const reading of readings) {
    const chairId = ids[reading.chairName];
    if (!chairId) {
      logger.warn(`[shelly-sync] Chair ${reading.chairName} not found in DB`);
      continue;
    }
    try {
      await chairStateService.processChairReading(chairId, {
        powerWatts: reading.powerWatts,
        isOnline: reading.isOnline,
        relayIsOn: reading.relayIsOn,
        recordedAt: now,
      });
    } catch (err) {
      logger.error(`[shelly-sync] State machine error for ${reading.chairName}: ${String(err)}`);
    }
  }

  lastSyncAt = now;
  consecutiveErrors = 0;
}

/**
 * Wrapper that suppresses log spam for repeated network errors.
 * Returns true if the tick succeeded, false on error.
 */
export async function tryShellySyncTick(): Promise<boolean> {
  try {
    await processShellySyncTick();
    return true;
  } catch (err) {
    consecutiveErrors++;
    // Always log first error; then only log every MAX_CONSECUTIVE_LOG
    if (consecutiveErrors === 1 || consecutiveErrors % MAX_CONSECUTIVE_LOG === 0) {
      logger.error(
        `[shelly-sync] Tick failed (${consecutiveErrors} consecutive): ${String(err)}`,
      );
    }
    return false;
  }
}

export function getLastShellySyncAt(): Date | null {
  return lastSyncAt;
}

/** Invalidate the chair ID cache (e.g. after chair config changes). */
export function resetShellyChairIdCache(): void {
  chairIdCache = null;
}
