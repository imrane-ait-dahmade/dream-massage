import type { Server } from 'socket.io';
import { env } from '../config/env';
import { dashboardService } from '../modules/dashboard/dashboard.service';
import { processSimulationTick, getSimulationTick } from './fake-power-simulation.job';
import {
  tryShellySyncTick,
  getLastShellySyncAt,
  acquireShellyWorkerLock,
  releaseShellyWorkerLock,
} from './shelly-sync.job';
import { isShellyConfigured } from '../modules/shelly/shelly.service';
import { hydrateRuntimeCache, isRuntimeHydrated } from '../modules/chairs/chair-runtime-cache';
import { logger } from '../utils/logger';
import { usageMetrics } from '../utils/usage-metrics';
import { DbUnavailableError } from '../utils/db-circuit-breaker';

// Log a summary every N ticks to avoid flooding the console.
const LOG_EVERY_N_TICKS = Math.max(1, Math.round(60_000 / Math.max(env.SYNC_INTERVAL_MS, 1000)));

let tickCount = 0;
let intervalId: NodeJS.Timeout | null = null;
let lastSimulationTickAt: Date | null = null;
let lastShellyAttemptMs = 0;
let lastBroadcastMs = 0;
let startedOnce = false;

/** Process-level singleton — prevents double start from duplicate imports/hot reload. */
const g = globalThis as unknown as { __realtimeJobStarted?: boolean };

export type ActiveSource = 'simulation' | 'shelly' | 'none';

export function getActiveSource(): ActiveSource {
  if (env.SIMULATION_ENABLED) return 'simulation';
  if (isShellyConfigured()) return 'shelly';
  return 'none';
}

export function getLastSimulationTickAt(): Date | null {
  return lastSimulationTickAt;
}

export function isRealtimeJobRunning(): boolean {
  return intervalId !== null;
}

export function startRealtimeJob(io: Server): void {
  if (intervalId !== null || g.__realtimeJobStarted) {
    logger.warn('[realtime-job] Already running — skip duplicate start');
    return;
  }

  if (!acquireShellyWorkerLock()) {
    logger.warn('[realtime-job] Shelly worker lock held by another starter — skip');
    return;
  }

  g.__realtimeJobStarted = true;
  startedOnce = true;

  const source = getActiveSource();
  logger.info('[realtime-job] started once');
  logger.info(
    `[realtime-job] Starting — interval ${env.SYNC_INTERVAL_MS}ms | shellyPoll ${env.SHELLY_POLL_INTERVAL_MS}ms | source: ${source}`,
  );
  if (source === 'none') {
    logger.warn('[realtime-job] Neither simulation nor Shelly is configured — chairs will not update');
  }

  usageMetrics.startReporting((line) => logger.info(line));

  // Hydrate memory cache once at start (non-blocking for listen)
  void hydrateRuntimeCache().catch((err: unknown) => {
    logger.warn(`[realtime-job] Initial hydrate failed: ${String(err)}`);
  });

  intervalId = setInterval(() => {
    tickCount++;
    const tick = tickCount;

    (async () => {
      let hadTransition = false;

      if (env.SIMULATION_ENABLED) {
        await processSimulationTick().catch((err: unknown) => {
          logger.warn(`[realtime-job] Simulation tick #${tick} error: ${String(err)}`);
        });
        lastSimulationTickAt = new Date();
        hadTransition = true; // simulation may change state; broadcast on its cadence
      } else if (isShellyConfigured()) {
        const nowMs = Date.now();
        if (nowMs - lastShellyAttemptMs >= env.SHELLY_POLL_INTERVAL_MS) {
          lastShellyAttemptMs = nowMs;
          const result = await tryShellySyncTick();
          hadTransition = result.hadTransition;
        }
      }

      // Broadcast: on real transition, or heartbeat at DASHBOARD_FALLBACK_REFRESH_MS
      const nowMs = Date.now();
      const heartbeatDue = nowMs - lastBroadcastMs >= env.DASHBOARD_FALLBACK_REFRESH_MS;
      if (hadTransition || heartbeatDue || lastBroadcastMs === 0) {
        try {
          const state = await dashboardService.getState();
          io.emit('dashboard:update', state);
          lastBroadcastMs = nowMs;
        } catch (err) {
          if (err instanceof DbUnavailableError) {
            // Do not emit a fake empty dashboard
            io.emit('dashboard:unavailable', {
              message: 'Service temporairement indisponible. Nouvelle tentative automatique.',
              retryAfterSec: err.retryAfterSec,
            });
          } else {
            logger.error(`[realtime-job] Broadcast failed: ${String(err)}`);
          }
        }
      }

      if (tick % LOG_EVERY_N_TICKS === 0) {
        const memOk = isRuntimeHydrated();
        logger.info(
          `[realtime-job] Tick #${tick} (${getActiveSource()}) — mem=${memOk} lastBroadcastAgeMs=${nowMs - lastBroadcastMs}`,
        );
      }
    })().catch((err: unknown) => {
      logger.error(`[realtime-job] Tick #${tick} fatal error: ${String(err)}`);
    });
  }, env.SYNC_INTERVAL_MS);
}

export function stopRealtimeJob(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    g.__realtimeJobStarted = false;
    releaseShellyWorkerLock();
    usageMetrics.stopReporting();
    logger.info('[realtime-job] Stopped');
  }
}

/** Test helper */
export function _resetRealtimeJobForTests(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  g.__realtimeJobStarted = false;
  startedOnce = false;
  tickCount = 0;
  lastShellyAttemptMs = 0;
  lastBroadcastMs = 0;
  releaseShellyWorkerLock();
  usageMetrics.stopReporting();
}

export function wasStartedOnce(): boolean {
  return startedOnce;
}

export { getLastShellySyncAt, getSimulationTick };
