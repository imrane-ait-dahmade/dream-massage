import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { dashboardService } from './modules/dashboard/dashboard.service';
import { createSocketServer } from './socket';
import { startMockRealtimeJob, stopMockRealtimeJob } from './jobs/mock-realtime.job';

const app = express();

app.use(
  cors({
    origin: [env.FRONTEND_ORIGIN, 'http://localhost:3000'],
    credentials: true,
  }),
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'dream-massage-realtime-server',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

app.get('/api/dashboard/state', (_req, res) => {
  res.json(dashboardService.getState());
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

const httpServer = createServer(app);
const io = createSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info('─────────────────────────────────────────');
  logger.info('Dream Massage realtime server started');
  logger.info(`  Port     : ${env.PORT}`);
  logger.info(`  Mode     : ${env.NODE_ENV}`);
  logger.info(`  Origin   : ${env.FRONTEND_ORIGIN}`);
  logger.info('─────────────────────────────────────────');
  startMockRealtimeJob(io);
});

function shutdown(signal: string): void {
  logger.info(`[server] ${signal} — shutting down`);
  stopMockRealtimeJob();
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
