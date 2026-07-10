'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getDashboardState, ApiError } from '@/lib/api';
import { createSocket, SOCKET_URL } from '@/lib/socket';
import type { DashboardState } from '@/lib/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'unavailable';

const FALLBACK_POLL_MS = 60_000;
const SOCKET_DEBOUNCE_MS = 750;
const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;

export function useDashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('connecting');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [serviceMessage, setServiceMessage] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  const backoffIdxRef = useRef(0);
  const visibleRef = useRef(true);

  const applyState = useCallback((data: DashboardState) => {
    setState(data);
    setLastUpdated(new Date());
    setServiceMessage(null);
    backoffIdxRef.current = 0;
  }, []);

  const fetchState = useCallback(async (reason: string) => {
    if (!visibleRef.current && reason !== 'visible') return;
    if (inFlightRef.current) return; // no overlapping requests

    const ac = new AbortController();
    inFlightRef.current = ac;
    try {
      const data = await getDashboardState();
      if (!ac.signal.aborted) applyState(data);
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      if (err instanceof ApiError && err.kind === 'unavailable') {
        setConnStatus('unavailable');
        setServiceMessage(
          'Service temporairement indisponible. Nouvelle tentative automatique.',
        );
        const delay = (err.retryAfterSec ?? 60) * 1000;
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = setTimeout(() => {
          void fetchState('backoff');
        }, delay);
      } else {
        const idx = Math.min(backoffIdxRef.current, BACKOFF_MS.length - 1);
        const delay = BACKOFF_MS[idx];
        backoffIdxRef.current = Math.min(backoffIdxRef.current + 1, BACKOFF_MS.length - 1);
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[dashboard] fetch failed (${reason}), backoff ${delay}ms`, err);
        }
        if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = setTimeout(() => {
          void fetchState('backoff');
        }, delay);
      }
    } finally {
      if (inFlightRef.current === ac) inFlightRef.current = null;
    }
  }, [applyState]);

  useEffect(() => {
    let cancelled = false;
    visibleRef.current = typeof document === 'undefined' || document.visibilityState !== 'hidden';

    void fetchState('initial');

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
        console.log('[dashboard] WebSocket unavailable — REST fallback poll (60s)');
      }
      pollRef.current = setInterval(() => {
        void fetchState('poll');
      }, FALLBACK_POLL_MS);
    };

    const onVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
      if (visibleRef.current) {
        void fetchState('visible');
      } else {
        stopPoll();
        if (inFlightRef.current) {
          inFlightRef.current.abort();
          inFlightRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    socket.on('connect', () => {
      if (cancelled) return;
      if (process.env.NODE_ENV === 'development') {
        console.log(`[socket] Connected — id: ${socket.id} url: ${SOCKET_URL}`);
      }
      setConnStatus('connected');
      stopPoll();
    });

    socket.on('disconnect', (reason: string) => {
      if (cancelled) return;
      if (process.env.NODE_ENV === 'development') {
        console.warn('[socket] Disconnected:', reason);
      }
      setConnStatus('disconnected');
      if (visibleRef.current) startPoll();
    });

    socket.on('connect_error', (err: Error) => {
      if (cancelled) return;
      if (process.env.NODE_ENV === 'development') {
        console.warn('[socket] connect_error:', err.message, '— will retry');
      }
      setConnStatus('disconnected');
      if (visibleRef.current) startPoll();
    });

    socket.on('dashboard:update', (data: DashboardState) => {
      if (cancelled || !visibleRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        applyState(data);
        setConnStatus('connected');
      }, SOCKET_DEBOUNCE_MS);
    });

    socket.on(
      'dashboard:unavailable',
      (payload: { message?: string; retryAfterSec?: number }) => {
        if (cancelled) return;
        setConnStatus('unavailable');
        setServiceMessage(
          payload?.message ??
            'Service temporairement indisponible. Nouvelle tentative automatique.',
        );
      },
    );

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('dashboard:update');
      socket.off('dashboard:unavailable');
      socket.disconnect();
      stopPoll();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
      if (inFlightRef.current) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
      }
    };
  }, [fetchState, applyState]);

  return { state, connStatus, lastUpdated, serviceMessage };
}
