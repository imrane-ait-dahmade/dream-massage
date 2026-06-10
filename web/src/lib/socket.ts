import { io, type Socket } from 'socket.io-client';

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL?.replace(/\/$/, '') ?? 'http://localhost:4001';

if (process.env.NODE_ENV === 'development') {
  console.log('[socket] NEXT_PUBLIC_SOCKET_URL =', process.env.NEXT_PUBLIC_SOCKET_URL ?? '(not set — using fallback)');
  console.log('[socket] Socket URL =', SOCKET_URL);
}

export function createSocket(): Socket {
  return io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });
}
