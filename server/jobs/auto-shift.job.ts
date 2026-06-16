import { env } from '../config/env';
import { autoShiftService } from '../modules/shifts/auto-shift.service';
import { logger } from '../utils/logger';

// ── Module-level state ─────────────────────────────────────────────────────────

let intervalId:    NodeJS.Timeout | null = null;
let lastRunAt:     Date | null           = null;
let lastOpenCount  = 0;
let lastCloseCount = 0;
let lastError:     string | null         = null;

// ── Status ─────────────────────────────────────────────────────────────────────

export function getAutoShiftStatus() {
  return {
    autoShiftEnabled:      env.AUTO_SHIFT_ENABLED,
    intervalMs:            env.AUTO_SHIFT_CHECK_INTERVAL_MS,
    allowMultipleOpenShifts: env.ALLOW_MULTIPLE_OPEN_SHIFTS,
    lastRunAt:             lastRunAt?.toISOString() ?? null,
    lastOpenCount,
    lastCloseCount,
    lastError,
  };
}

// ── Run ────────────────────────────────────────────────────────────────────────

export async function runAutoShiftSyncJob(): Promise<{ opened: number; closed: number }> {
  try {
    const result   = await autoShiftService.runAutoShiftSync();
    lastRunAt      = new Date();
    lastOpenCount  = result.opened;
    lastCloseCount = result.closed;
    lastError      = null;
    return result;
  } catch (err) {
    lastError = String(err);
    logger.error('[auto-shift-job] Sync error:', lastError);
    return { opened: 0, closed: 0 };
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

export function startAutoShiftJob(): void {
  if (!env.AUTO_SHIFT_ENABLED) {
    logger.info('[auto-shift-job] Disabled (AUTO_SHIFT_ENABLED=false) — skipping');
    return;
  }
  if (intervalId !== null) {
    logger.warn('[auto-shift-job] Already running');
    return;
  }

  logger.info(
    `[auto-shift-job] Starting — ` +
    `interval=${env.AUTO_SHIFT_CHECK_INTERVAL_MS}ms | ` +
    `allowMultipleOpenShifts=${env.ALLOW_MULTIPLE_OPEN_SHIFTS}`,
  );

  // Run once immediately on startup so shifts that opened while the server was
  // down are created/closed without waiting for the first interval tick.
  runAutoShiftSyncJob().catch((err: unknown) => {
    logger.error('[auto-shift-job] Initial sync error:', String(err));
  });

  intervalId = setInterval(() => {
    runAutoShiftSyncJob().catch((err: unknown) => {
      logger.error('[auto-shift-job] Interval error:', String(err));
    });
  }, env.AUTO_SHIFT_CHECK_INTERVAL_MS);
}

export function stopAutoShiftJob(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[auto-shift-job] Stopped');
  }
}
