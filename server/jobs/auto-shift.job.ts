import { env } from '../config/env';
import { runAutoShiftCheck } from '../modules/shifts/auto-shift.service';
import type { AutoShiftCheckResult } from '../modules/shifts/auto-shift.types';
import { getTimezone, msUntilNextQuarterHour } from '../utils/time';
import { logger } from '../utils/logger';

// ── Module-level state ─────────────────────────────────────────────────────────

let timeoutId:     NodeJS.Timeout | null = null;
let lastRunAt:     Date | null           = null;
let lastResult:    AutoShiftCheckResult | null = null;
let lastError:     string | null         = null;

// ── Status ─────────────────────────────────────────────────────────────────────

export function getAutoShiftStatus() {
  return {
    autoShiftEnabled:        env.AUTO_SHIFT_ENABLED,
    intervalMs:              env.AUTO_SHIFT_CHECK_INTERVAL_MS,
    shopOpenTime:            env.AUTO_SHIFT_SHOP_OPEN_TIME,
    shopCloseTime:           env.AUTO_SHIFT_SHOP_CLOSE_TIME,
    timezone:                getTimezone(),
    allowMultipleOpenShifts: env.ALLOW_MULTIPLE_OPEN_SHIFTS,
    lastRunAt:               lastRunAt?.toISOString() ?? null,
    lastResult,
    lastError,
  };
}

// ── Run ────────────────────────────────────────────────────────────────────────

export async function runAutoShiftSyncJob(): Promise<AutoShiftCheckResult> {
  try {
    const result = await runAutoShiftCheck();
    lastRunAt    = new Date();
    lastResult   = result;
    lastError    = null;
    return result;
  } catch (err) {
    lastError = String(err);
    logger.error('[auto-shift-job] Sync error:', lastError);
    const fallback: AutoShiftCheckResult = {
      opened:        false,
      closed:        false,
      closedIds:     [],
      openFound:     false,
      activeShiftId: null,
      message:       `error: ${lastError}`,
      checkedAt:     new Date().toISOString(),
      openedCount:   0,
      closedCount:   0,
    };
    lastResult = fallback;
    return fallback;
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

function scheduleNextAlignedRun(): void {
  const delay = msUntilNextQuarterHour();
  logger.info(`[auto-shift-job] Next aligned check in ${Math.round(delay / 1000)}s`);
  timeoutId = setTimeout(() => {
    runAutoShiftSyncJob()
      .catch((err: unknown) => {
        logger.error('[auto-shift-job] Aligned run error:', String(err));
      })
      .finally(() => {
        scheduleNextAlignedRun();
      });
  }, delay);
}

export function startAutoShiftJob(): void {
  if (!env.AUTO_SHIFT_ENABLED) {
    logger.info('[auto-shift-job] Disabled (AUTO_SHIFT_ENABLED=false) — skipping');
    return;
  }
  if (timeoutId !== null) {
    logger.warn('[auto-shift-job] Already running');
    return;
  }

  const tz = getTimezone();
  logger.info(
    `[auto-shift-job] Starting — aligned :00/:15/:30/:45 in ${tz} | ` +
    `shop=${env.AUTO_SHIFT_SHOP_OPEN_TIME}–${env.AUTO_SHIFT_SHOP_CLOSE_TIME} | ` +
    `allowMultipleOpenShifts=${env.ALLOW_MULTIPLE_OPEN_SHIFTS}`,
  );

  runAutoShiftSyncJob()
    .catch((err: unknown) => {
      logger.error('[auto-shift-job] Initial sync error:', String(err));
    })
    .finally(() => {
      scheduleNextAlignedRun();
    });
}

export function stopAutoShiftJob(): void {
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
    logger.info('[auto-shift-job] Stopped');
  }
}
