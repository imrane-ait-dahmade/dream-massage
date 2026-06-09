import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { dashboardService } from './modules/dashboard/dashboard.service';
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
import { processSimulationTick } from './jobs/fake-power-simulation.job';
import { shellyService, isShellyConfigured, getMissingFields } from './modules/shelly/shelly.service';

const app = express();

app.use(
  cors({
    origin: [env.FRONTEND_ORIGIN, 'http://localhost:3000'],
    credentials: true,
  }),
);
app.use(express.json());

// ── Health ─────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'dream-massage-realtime-server',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// ── Dashboard ──────────────────────────────────────────────────────────────────

app.get('/api/dashboard/state', (_req, res) => {
  dashboardService
    .getState()
    .then((state) => res.json(state))
    .catch((err) => {
      res.status(500).json({ ok: false, error: 'Failed to read dashboard state', detail: String(err) });
    });
});

// ── Shelly ─────────────────────────────────────────────────────────────────────

app.get('/api/shelly/config', (_req, res) => {
  const devices = (['F1', 'F2', 'F3', 'F4', 'F5'] as const).map((name) => {
    const raw = env[`SHELLY_DEVICE_${name}` as keyof typeof env] as string | undefined;
    const entry: { chairName: string; deviceIdConfigured: boolean; deviceIdMasked?: string } = {
      chairName: name,
      deviceIdConfigured: !!raw,
    };
    // Show a masked ID in development so the env can be verified without exposing it fully
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

// ── Dev-only endpoints (never enabled in production) ───────────────────────────

if (env.NODE_ENV !== 'production') {
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

  // POST /api/dev/chairs/:chairId/reading
  // Body: { "powerWatts": 12.5, "isOnline": true, "relayIsOn"?: true }
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

// ── 404 ────────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ── Bootstrap ──────────────────────────────────────────────────────────────────

const httpServer = createServer(app);
const io = createSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info('─────────────────────────────────────────');
  logger.info('Dream Massage realtime server started');
  logger.info(`  Port       : ${env.PORT}`);
  logger.info(`  Mode       : ${env.NODE_ENV}`);
  logger.info(`  Origin     : ${env.FRONTEND_ORIGIN}`);
  const activeSource = getActiveSource();
  logger.info(`  simulationEnabled : ${env.SIMULATION_ENABLED}${env.SIMULATION_FAST_MODE ? ' (fast-mode)' : ''}`);
  logger.info(`  activeSource      : ${activeSource}`);
  logger.info(`  shellyConfigured  : ${isShellyConfigured()}`);
  if (activeSource === 'shelly') {
    logger.info(`  shellyPollMs      : ${env.SHELLY_POLL_INTERVAL_MS}`);
  }
  logger.info('─────────────────────────────────────────');
  startRealtimeJob(io);
});

function shutdown(signal: string): void {
  logger.info(`[server] ${signal} — shutting down`);
  stopRealtimeJob();
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
