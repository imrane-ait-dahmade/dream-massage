import type { Server } from 'socket.io';
import { env } from '../config/env';
import { dashboardService } from '../modules/dashboard/dashboard.service';
import { processSimulationTick, getSimulationTick } from './fake-power-simulation.job';
import { tryShellySyncTick, getLastShellySyncAt } from './shelly-sync.job';
import { isShellyConfigured } from '../modules/shelly/shelly.service';
import { logger } from '../utils/logger';

// Log a summary every N ticks to avoid flooding the console.
const LOG_EVERY_N_TICKS = Math.max(1, Math.round(5000 / env.SYNC_INTERVAL_MS));

let tickCount = 0;
let intervalId: NodeJS.Timeout | null = null;
let lastSimulationTickAt: Date | null = null;
// Track last Shelly poll attempt to enforce SHELLY_POLL_INTERVAL_MS throttle
let lastShellyAttemptMs = 0;

export type ActiveSource = 'simulation' | 'shelly' | 'none';

export function getActiveSource(): ActiveSource {
  if (env.SIMULATION_ENABLED) return 'simulation';
  if (isShellyConfigured()) return 'shelly';
  return 'none';
}

export function getLastSimulationTickAt(): Date | null {
  return lastSimulationTickAt;
}

export function startRealtimeJob(io: Server): void {
  if (intervalId !== null) {
    logger.warn('[realtime-job] Already running');
    return;
  }

  const source = getActiveSource();
  logger.info(
    `[realtime-job] Starting — interval ${env.SYNC_INTERVAL_MS}ms | source: ${source}`,
  );
  if (source === 'none') {
    logger.warn('[realtime-job] Neither simulation nor Shelly is configured — chairs will not update');
  }

  intervalId = setInterval(() => {
    tickCount++;
    const tick = tickCount;

    // Order: read source → update DB via state machine → read DB → broadcast
    (async () => {
      if (env.SIMULATION_ENABLED) {
        // ── Simulation (development/testing only) ──────────────────────────
        await processSimulationTick().catch((err: unknown) => {
          logger.warn(`[realtime-job] Simulation tick #${tick} error: ${String(err)}`);
        });
        lastSimulationTickAt = new Date();
      } else if (isShellyConfigured()) {
        // ── Real Shelly Cloud readings (throttled to SHELLY_POLL_INTERVAL_MS) ──
        const nowMs = Date.now();
        if (nowMs - lastShellyAttemptMs >= env.SHELLY_POLL_INTERVAL_MS) {
          lastShellyAttemptMs = nowMs;
          await tryShellySyncTick();
        }
      }
      // else: no source configured — just broadcast whatever is in the DB

      // Read current state from DB and broadcast
      const state = await dashboardService.getState();
      io.emit('dashboard:update', state);

      if (tick % LOG_EVERY_N_TICKS === 0) {
        const active = state.chairs.filter((c) => c.status === 'ACTIVE').length;
        const maybe = state.chairs.filter((c) => c.status === 'MAYBE_FINISHED').length;
        logger.info(
          `[realtime-job] Tick #${tick} (${getActiveSource()}) — ${active} ACTIVE, ${maybe} MAYBE_FINISHED`,
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
    logger.info('[realtime-job] Stopped');
  }
}

export { getLastShellySyncAt, getSimulationTick };
