import { Server as HTTPServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { env } from './config/env';
import { dashboardService } from './modules/dashboard/dashboard.service';
import { logger } from './utils/logger';

let io: SocketServer | null = null;

export function createSocketServer(httpServer: HTTPServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: [env.FRONTEND_ORIGIN, 'http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    logger.info(`[socket] Client connected — id: ${socket.id}`);
    // Send current state immediately on connect so the client doesn't wait for next tick
    dashboardService.getState().then((state) => {
      socket.emit('dashboard:update', state);
    });

    socket.on('disconnect', (reason) => {
      logger.info(`[socket] Client disconnected — id: ${socket.id} reason: ${reason}`);
    });

    socket.on('error', (err) => {
      logger.error(`[socket] Error on ${socket.id}:`, err.message);
    });
  });

  return io;
}

export function getSocketServer(): SocketServer {
  if (!io) throw new Error('Socket.IO server not initialised. Call createSocketServer() first.');
  return io;
}
