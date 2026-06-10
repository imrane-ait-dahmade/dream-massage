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
    withCredentials: true, // send the auth cookie so future Socket.IO auth middleware can read it
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });
}
// TODO: add Socket.IO auth middleware on the server to verify the JWT cookie on connect
