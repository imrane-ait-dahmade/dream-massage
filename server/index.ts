import express, { type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { dashboardService, revenueStatsService } from './modules/dashboard/dashboard.service';
import { homeDashboardService } from './modules/dashboard/home-dashboard.service';
import { chairStateService } from './modules/chairs/chair-state.service';
import { createSocketServer } from './socket';
import {
  startRealtimeJob,
  stopRealtimeJob,
  getActiveSource,
  getLastSimulationTickAt,
  getLastShellySyncAt,
  getSimulationTick,
} from './jobs/mock-realtime.job';
import { startAutoShiftJob, stopAutoShiftJob } from './jobs/auto-shift.job';
import { runAutoShiftCheck } from './modules/shifts/auto-shift.service';
import { processSimulationTick } from './jobs/fake-power-simulation.job';
import { shellyService, isShellyConfigured, getMissingFields } from './modules/shelly/shelly.service';
import { corsOriginFn } from './config/cors';
import { requireAuth, requireOwnerAdmin } from './middleware/auth.middleware';
import { requireCronSecret } from './middleware/shift-automation.middleware';
import { prisma } from './prisma';
import { getTimezone } from './utils/time';
import { usageMetrics } from './utils/usage-metrics';
import { DbUnavailableError } from './utils/db-circuit-breaker';
import authRouter from './modules/auth/auth.controller';
import chairRouter from './modules/chairs/chair.controller';
import settingsRouter from './modules/settings/settings.controller';
import shiftRouter from './modules/shifts/shift.controller';
import sessionRouter from './modules/sessions/session.controller';
import assistantRouter from './modules/assistant/assistant.controller';

const app = express();

app.use(cors({
  origin: corsOriginFn,
  credentials: true,
  // Explicitly allow Authorization so Safari's strict OPTIONS preflight accepts it.
  // Without this, the cors package reflects request headers which Safari may reject.
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(cookieParser());

// ── Health (public) ────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const status = dbOk ? 200 : 503;
  res.status(status).json({
    ok:        dbOk,
    service:   'dream-massage-realtime-server',
    timestamp: new Date().toISOString(),
    timezone:  getTimezone(),
    uptime:    Math.floor(process.uptime()),
    database:  dbOk ? 'connected' : 'unavailable',
    ...(dbError ? { dbError } : {}),
  });
});

// ── Auth routes (public — login must be registered BEFORE requireAuth) ─────────

app.use('/api/auth', authRouter);

// ── Assistant (read-only — scoped by role in assistant.controller) ─────────────

app.use('/api/assistant', requireAuth, assistantRouter);

// ── Protected owner/admin routes ───────────────────────────────────────────────

app.use('/api/dashboard', requireAuth, requireOwnerAdmin);
app.get('/api/dashboard/state', (_req, res) => {
  const started = Date.now();
  usageMetrics.incr('apiCalls');
  dashboardService
    .getState()
    .then((state) => {
      const body = JSON.stringify(state);
      const bytes = Buffer.byteLength(body);
      usageMetrics.incr('apiResponseBytes', bytes);
      if (bytes > 100_000) {
        logger.warn(`[api-size] route=/api/dashboard/state bytes=${bytes} durationMs=${Date.now() - started}`);
      }
      res.type('json').send(body);
    })
    .catch((err) => {
      if (err instanceof DbUnavailableError) {
        res.setHeader('Retry-After', String(err.retryAfterSec));
        res.status(503).json({
          ok: false,
          error: 'Service temporairement indisponible. Nouvelle tentative automatique.',
        });
        return;
      }
      res.status(500).json({ ok: false, error: 'Failed to read dashboard state' });
    });
});

app.get('/api/dashboard/revenue-stats', (req, res) => {
  const started = Date.now();
  usageMetrics.incr('apiCalls');
  const raw = typeof req.query.period === 'string' ? req.query.period : 'week';
  const period = ['day', 'week', 'month', 'year'].includes(raw) ? raw : 'week';
  revenueStatsService
    .get(period)
    .then((stats) => {
      const body = JSON.stringify(stats);
      const bytes = Buffer.byteLength(body);
      usageMetrics.incr('apiResponseBytes', bytes);
      if (bytes > 100_000) {
        logger.warn(`[api-size] route=/api/dashboard/revenue-stats bytes=${bytes} durationMs=${Date.now() - started}`);
      }
      res.type('json').send(body);
    })
    .catch((err) => {
      if (err instanceof DbUnavailableError) {
        res.setHeader('Retry-After', String(err.retryAfterSec));
        res.status(503).json({
          ok: false,
          error: 'Service temporairement indisponible. Nouvelle tentative automatique.',
        });
        return;
      }
      res.status(500).json({ ok: false, error: 'Failed to compute revenue stats' });
    });
});

app.get('/api/dashboard/home', (req, res) => {
  const started = Date.now();
  usageMetrics.incr('apiCalls');
  const q = req.query;
  const str = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined);
  homeDashboardService
    .get({
      preset:       str('preset'),
      from:         str('from'),
      to:           str('to'),
      period:       str('period'),
      periodStart:  str('periodStart'),
      periodEnd:    str('periodEnd'),
      chair:        str('chair'),
      staffMemberId: str('staffMemberId'),
      shiftTypeId:   str('shiftTypeId'),
      shiftId:       str('shiftId'),
      status:        str('status'),
      chartPeriod:   str('chartPeriod'),
    })
    .then((data) => {
      const body = JSON.stringify(data);
      const bytes = Buffer.byteLength(body);
      usageMetrics.incr('apiResponseBytes', bytes);
      if (bytes > 100_000) {
        logger.warn(`[api-size] route=/api/dashboard/home bytes=${bytes} durationMs=${Date.now() - started}`);
      }
      res.type('json').send(body);
    })
    .catch((err: unknown) => {
      if (err instanceof DbUnavailableError) {
        res.setHeader('Retry-After', String(err.retryAfterSec));
        res.status(503).json({
          ok: false,
          error: 'Service temporairement indisponible. Nouvelle tentative automatique.',
        });
        return;
      }
      res.status(500).json({ ok: false, error: 'Failed to compute home dashboard' });
    });
});

// ── Shelly (protected) ─────────────────────────────────────────────────────────

app.use('/api/shelly', requireAuth, requireOwnerAdmin);

app.get('/api/shelly/config', (_req, res) => {
  const devices = (['F1', 'F2', 'F3', 'F4', 'F5'] as const).map((name) => {
    const raw = env[`SHELLY_DEVICE_${name}` as keyof typeof env] as string | undefined;
    const entry: { chairName: string; deviceIdConfigured: boolean; deviceIdMasked?: string } = {
      chairName: name,
      deviceIdConfigured: !!raw,
    };
    if (env.NODE_ENV === 'development' && raw) {
      entry.deviceIdMasked = raw.slice(0, 4) + '***';
    }
    return entry;
  });

  res.json({
    ok: true,
    simulationEnabled: env.SIMULATION_ENABLED,
    serverUrlConfigured: !!env.SHELLY_SERVER_URL,
    authKeyConfigured: !!env.SHELLY_AUTH_KEY,
    devices,
  });
});

app.get('/api/shelly/test', (_req, res) => {
  if (env.SIMULATION_ENABLED) {
    res.status(400).json({
      ok: false,
      error: 'Simulation is enabled. Set SIMULATION_ENABLED=false to test real Shelly.',
    });
    return;
  }

  const missing = getMissingFields();
  if (missing.length > 0) {
    res.status(400).json({ ok: false, error: 'Shelly environment not fully configured', missing });
    return;
  }

  shellyService
    .fetchDeviceStates()
    .then((readings) => {
      res.json({
        ok: true,
        readings: readings.map((r) => ({
          chairName: r.chairName,
          isOnline: r.isOnline,
          powerWatts: r.powerWatts,
          relayIsOn: r.relayIsOn,
        })),
      });
    })
    .catch((err: unknown) => {
      res.status(502).json({ ok: false, error: String(err) });
    });
});

// ── Dev-only endpoints (protected) ────────────────────────────────────────────

if (env.NODE_ENV !== 'production') {
  app.use('/api/dev', requireAuth, requireOwnerAdmin);

  app.get('/api/dev/source-status', (_req, res) => {
    res.json({
      simulationEnabled: env.SIMULATION_ENABLED,
      activeSource: getActiveSource(),
      lastShellySyncAt: getLastShellySyncAt()?.toISOString() ?? null,
      lastSimulationTickAt: getLastSimulationTickAt()?.toISOString() ?? null,
    });
  });

  app.get('/api/dev/simulation/status', (_req, res) => {
    res.json({
      simulationEnabled: env.SIMULATION_ENABLED,
      fastMode: env.SIMULATION_FAST_MODE,
      simTick: getSimulationTick(),
      syncIntervalMs: env.SYNC_INTERVAL_MS,
      effectiveStartConfirmSeconds: env.SIMULATION_FAST_MODE ? 5 : '(from DB config)',
      effectiveStopConfirmSeconds: env.SIMULATION_FAST_MODE ? 10 : '(from DB config)',
    });
  });

  app.post('/api/dev/simulation/tick', (_req, res) => {
    processSimulationTick()
      .then(() => res.json({ ok: true, tick: getSimulationTick() }))
      .catch((err) => res.status(500).json({ ok: false, error: String(err) }));
  });

  app.post('/api/dev/chairs/:chairId/reading', (req, res) => {
    const { chairId } = req.params;
    const { powerWatts, isOnline, relayIsOn } = req.body as {
      powerWatts?: unknown;
      isOnline?: unknown;
      relayIsOn?: unknown;
    };

    if (typeof powerWatts !== 'number' || typeof isOnline !== 'boolean') {
      res.status(400).json({ ok: false, error: 'Body must have powerWatts: number and isOnline: boolean' });
      return;
    }

    chairStateService
      .processChairReading(chairId, {
        powerWatts,
        isOnline,
        relayIsOn: typeof relayIsOn === 'boolean' ? relayIsOn : undefined,
        recordedAt: new Date(),
      })
      .then(() => res.json({ ok: true, chairId, powerWatts, isOnline }))
      .catch((err) => res.status(500).json({ ok: false, error: String(err) }));
  });
}

// ── Chairs (protected) ─────────────────────────────────────────────────────────

app.use('/api/chairs', requireAuth, requireOwnerAdmin, chairRouter);

// ── Settings (protected) ───────────────────────────────────────────────────────

app.use('/api/settings', requireAuth, requireOwnerAdmin, settingsRouter);

// ── Shifts (protected) ─────────────────────────────────────────────────────────

// ── Internal automation (secret — no JWT) ─────────────────────────────────────

function handleAutoShiftTrigger(_req: Request, res: Response): void {
  runAutoShiftCheck()
    .then((result) => res.json({ ok: true, ...result }))
    .catch((err: unknown) => {
      logger.error('[auto-shift] External trigger failed:', String(err));
      res.status(500).json({ ok: false, error: 'Internal server error' });
    });
}

app.post('/internal/jobs/auto-shift', requireCronSecret, handleAutoShiftTrigger);

// Legacy path — kept for existing GitHub workflow during migration.
app.post('/api/shifts/automation/run', requireCronSecret, handleAutoShiftTrigger);

app.use('/api/shifts', requireAuth, requireOwnerAdmin, shiftRouter);

// ── Sessions (protected) ───────────────────────────────────────────────────────

app.use('/api/sessions', requireAuth, requireOwnerAdmin, sessionRouter);

// ── 404 ────────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ── Bootstrap ──────────────────────────────────────────────────────────────────

const httpServer = createServer(app);
const io = createSocketServer(httpServer);

const PORT = Number(process.env.PORT ?? env.PORT);

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info('─────────────────────────────────────────');
  logger.info('Dream Massage realtime server started');
  logger.info(`  Port       : ${PORT}`);
  logger.info(`  Mode       : ${env.NODE_ENV}`);
  logger.info(`  CORS       : ${env.FRONTEND_ORIGIN} + any localhost:* in dev`);
  const activeSource = getActiveSource();
  logger.info(`  simulationEnabled : ${env.SIMULATION_ENABLED}${env.SIMULATION_FAST_MODE ? ' (fast-mode)' : ''}`);
  logger.info(`  activeSource      : ${activeSource}`);
  logger.info(`  shellyConfigured  : ${isShellyConfigured()}`);
  if (activeSource === 'shelly') {
    logger.info(`  shellyPollMs      : ${env.SHELLY_POLL_INTERVAL_MS}`);
  }
  logger.info(`  autoShiftEnabled  : ${env.AUTO_SHIFT_ENABLED}`);
  if (env.AUTO_SHIFT_ENABLED) {
    logger.info(`  autoShiftInterval : ${env.AUTO_SHIFT_CHECK_INTERVAL_MS}ms`);
    logger.info(`  multipleOpenShifts: ${env.ALLOW_MULTIPLE_OPEN_SHIFTS}`);
  }
  logger.info('─────────────────────────────────────────');
  startRealtimeJob(io);
  startAutoShiftJob();
});

function shutdown(signal: string): void {
  logger.info(`[server] ${signal} — shutting down`);
  stopRealtimeJob();
  stopAutoShiftJob();
  httpServer.close(() => {
    logger.info('[server] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('[server] Forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error('[server] Uncaught exception:', err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('[server] Unhandled rejection:', String(reason));
  process.exit(1);
});
