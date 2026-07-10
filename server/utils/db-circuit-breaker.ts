/**
 * Shared circuit breaker for temporary Neon / Postgres failures.
 * After consecutive failures, blocks automatic DB attempts for DB_ERROR_BACKOFF_MAX_MS.
 */

import { usageMetrics } from './usage-metrics';

export type CircuitState = 'closed' | 'open' | 'half-open';

const FAILURE_THRESHOLD = 3;
const SUMMARY_LOG_EVERY_MS = 60_000;

function openMs(): number {
  const raw = process.env.DB_ERROR_BACKOFF_MAX_MS;
  const n = raw ? parseInt(raw, 10) : 60_000;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

let consecutiveFailures = 0;
let openedAtMs: number | null = null;
let state: CircuitState = 'closed';
let lastSummaryLogMs = 0;
let lastErrorMessage = '';

export function isTemporaryDbError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('data transfer') ||
    msg.includes('exceeded') ||
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('connection terminated') ||
    msg.includes('too many connections') ||
    msg.includes('remaining connection slots') ||
    msg.includes('server closed the connection') ||
    msg.includes('cannot reach database') ||
    msg.includes('database unavailable') ||
    msg.includes('53300') ||
    msg.includes('57p01') ||
    msg.includes('08006') ||
    msg.includes('08001') ||
    msg.includes('p1001') ||
    msg.includes('p1002') ||
    msg.includes('p1017')
  );
}

export class DbUnavailableError extends Error {
  readonly retryAfterSec: number;
  constructor(message = 'Database temporarily unavailable', retryAfterSec = 60) {
    super(message);
    this.name = 'DbUnavailableError';
    this.retryAfterSec = retryAfterSec;
  }
}

function remainingOpenMs(): number {
  if (openedAtMs === null) return 0;
  return Math.max(0, openMs() - (Date.now() - openedAtMs));
}

export function getCircuitState(): CircuitState {
  if (state === 'open' && remainingOpenMs() === 0) {
    state = 'half-open';
  }
  return state;
}

export function getCircuitRetryAfterSec(): number {
  return Math.max(1, Math.ceil(remainingOpenMs() / 1000));
}

/** Returns false when automatic callers should skip the DB. */
export function allowDbAttempt(): boolean {
  const s = getCircuitState();
  if (s === 'open') {
    usageMetrics.incr('retriesBlocked');
    return false;
  }
  return true;
}

export function recordDbSuccess(): void {
  consecutiveFailures = 0;
  openedAtMs = null;
  state = 'closed';
}

export function recordDbFailure(
  err: unknown,
  log?: (line: string) => void,
): void {
  lastErrorMessage = err instanceof Error ? err.message : String(err);
  consecutiveFailures += 1;

  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    state = 'open';
    openedAtMs = Date.now();
  }

  const now = Date.now();
  if (now - lastSummaryLogMs >= SUMMARY_LOG_EVERY_MS) {
    lastSummaryLogMs = now;
    const line =
      `[db-circuit] state=${getCircuitState()} failures=${consecutiveFailures}` +
      ` retryAfterSec=${getCircuitRetryAfterSec()} last=${lastErrorMessage.slice(0, 160)}`;
    (log ?? console.error)(line);
  }
}

/**
 * Run an async DB operation behind the circuit breaker.
 * Throws DbUnavailableError when the circuit is open.
 */
export async function withDbCircuit<T>(fn: () => Promise<T>): Promise<T> {
  if (!allowDbAttempt()) {
    throw new DbUnavailableError(
      'Database circuit open — retry later',
      getCircuitRetryAfterSec(),
    );
  }
  try {
    const result = await fn();
    recordDbSuccess();
    return result;
  } catch (err) {
    if (isTemporaryDbError(err)) {
      recordDbFailure(err);
      throw new DbUnavailableError(
        'Database temporarily unavailable',
        getCircuitRetryAfterSec(),
      );
    }
    throw err;
  }
}

/** Test helpers */
export function _resetCircuitForTests(): void {
  consecutiveFailures = 0;
  openedAtMs = null;
  state = 'closed';
  lastSummaryLogMs = 0;
  lastErrorMessage = '';
}

export function _forceOpenForTests(): void {
  consecutiveFailures = FAILURE_THRESHOLD;
  openedAtMs = Date.now();
  state = 'open';
}
