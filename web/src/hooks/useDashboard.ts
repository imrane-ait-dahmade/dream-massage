'use client';

import { useState, useEffect, useRef } from 'react';
import { getDashboardState } from '@/lib/api';
import { createSocket, SOCKET_URL } from '@/lib/socket';
import type { DashboardState } from '@/lib/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function useDashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('connecting');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Initial REST fetch — setState called inside .then(), not in effect body
    void getDashboardState()
      .then((data) => {
        if (!cancelled) {
          setState(data);
          setLastUpdated(new Date());
        }
      })
      .catch((err: unknown) => {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[dashboard] Initial REST fetch failed:', String(err));
        }
      });

    const socket = createSocket();

    const stopPoll = () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const startPoll = () => {
      if (pollRef.current !== null) return;
      if (process.env.NODE_ENV === 'development') {
        console.log('[dashboard] WebSocket unavailable — starting REST fallback poll (10s)');
      }
      pollRef.current = setInterval(() => {
        void getDashboardState()
          .then((data) => {
            setState(data);
            setLastUpdated(new Date());
          })
          .catch(() => {});
      }, 10_000);
    };

    socket.on('connect', () => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[socket] Connected — id: ${socket.id} url: ${SOCKET_URL}`);
      }
      setConnStatus('connected');
      stopPoll();
    });

    socket.on('disconnect', (reason: string) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[socket] Disconnected:', reason);
      }
      setConnStatus('disconnected');
      startPoll();
    });

    socket.on('connect_error', (err: Error) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[socket] connect_error:', err.message, '— will retry');
      }
      setConnStatus('disconnected');
      startPoll();
    });

    socket.on('dashboard:update', (data: DashboardState) => {
      setState(data);
      setLastUpdated(new Date());
    });

    return () => {
      cancelled = true;
      socket.disconnect();
      stopPoll();
    };
  }, []); // socket lifecycle tied to component mount

  return { state, connStatus, lastUpdated };
}
