import type { Server } from 'socket.io';
import { env } from '../config/env';
import { dashboardService } from '../modules/dashboard/dashboard.service';
import { logger } from '../utils/logger';

const LOG_EVERY_N_TICKS = Math.max(1, Math.round(5000 / env.SYNC_INTERVAL_MS));
let tickCount = 0;
let intervalId: NodeJS.Timeout | null = null;

export function startMockRealtimeJob(io: Server): void {
  if (intervalId !== null) {
    logger.warn('[mock-job] Already running');
    return;
  }
  logger.info(`[mock-job] Starting (interval: ${env.SYNC_INTERVAL_MS}ms)`);
  intervalId = setInterval(() => {
    tickCount++;
    const state = dashboardService.getState();
    io.emit('dashboard:update', state);
    if (tickCount % LOG_EVERY_N_TICKS === 0) {
      const active = state.chairs.filter((c) => c.status === 'ACTIVE').length;
      logger.info(`[mock-job] Broadcast #${tickCount} — ${active} active chairs`);
    }
  }, env.SYNC_INTERVAL_MS);
}

export function stopMockRealtimeJob(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[mock-job] Stopped');
  }
}
