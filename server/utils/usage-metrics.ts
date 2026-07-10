/**
 * In-process usage counters for Neon egress diagnostics.
 * Never store PII, secrets, or full payloads here.
 */

export type MetricsSnapshot = {
  dbReads: number;
  dbWrites: number;
  apiCalls: number;
  apiResponseBytes: number;
  shellyTicks: number;
  dbReconciliations: number;
  stateTransitions: number;
  cacheHits: number;
  cacheMisses: number;
  retriesBlocked: number;
  powerFlushes: number;
};

const counters: MetricsSnapshot = {
  dbReads: 0,
  dbWrites: 0,
  apiCalls: 0,
  apiResponseBytes: 0,
  shellyTicks: 0,
  dbReconciliations: 0,
  stateTransitions: 0,
  cacheHits: 0,
  cacheMisses: 0,
  retriesBlocked: 0,
  powerFlushes: 0,
};

let reportIntervalId: NodeJS.Timeout | null = null;
const REPORT_EVERY_MS = 5 * 60_000;

export const usageMetrics = {
  incr(key: keyof MetricsSnapshot, by = 1): void {
    counters[key] += by;
  },

  snapshot(): MetricsSnapshot {
    return { ...counters };
  },

  reset(): void {
    for (const k of Object.keys(counters) as (keyof MetricsSnapshot)[]) {
      counters[k] = 0;
    }
  },

  startReporting(log: (line: string) => void = console.info): void {
    if (reportIntervalId !== null) return;
    reportIntervalId = setInterval(() => {
      const s = usageMetrics.snapshot();
      log(
        `[usage-metrics] ${JSON.stringify({
          dbReads: s.dbReads,
          dbWrites: s.dbWrites,
          apiCalls: s.apiCalls,
          apiResponseBytes: s.apiResponseBytes,
          shellyTicks: s.shellyTicks,
          dbReconciliations: s.dbReconciliations,
          stateTransitions: s.stateTransitions,
          cacheHits: s.cacheHits,
          cacheMisses: s.cacheMisses,
          retriesBlocked: s.retriesBlocked,
          powerFlushes: s.powerFlushes,
        })}`,
      );
      usageMetrics.reset();
    }, REPORT_EVERY_MS);
    // Don't keep the process alive solely for metrics.
    if (typeof reportIntervalId.unref === 'function') reportIntervalId.unref();
  },

  stopReporting(): void {
    if (reportIntervalId !== null) {
      clearInterval(reportIntervalId);
      reportIntervalId = null;
    }
  },
};
