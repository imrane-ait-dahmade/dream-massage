'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getHomeDashboard, ApiError } from '@/lib/api';
import type { HomeDashboardFilters, HomeDashboardResponse } from '@/lib/types';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultFilters(): HomeDashboardFilters {
  const today = todayISO();
  return {
    preset:        'today',
    from:          today,
    to:            today,
    period:        'all',
    chair:         'all',
    staffMemberId: 'all',
    shiftTypeId:   'all',
    shiftId:       'all',
    status:        'all',
    chartPeriod:   'day',
  };
}

const FALLBACK_POLL_MS = 60_000;
const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;

export function useHomeDashboard() {
  const [filters, _setFiltersInternal] = useState<HomeDashboardFilters>(defaultFilters());
  const [data, setData] = useState<HomeDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffIdxRef = useRef(0);
  const visibleRef = useRef(true);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const setFilters = useCallback((update: HomeDashboardFilters | ((prev: HomeDashboardFilters) => HomeDashboardFilters)) => {
    setLoading(true);
    setError(null);
    _setFiltersInternal(update);
  }, []);

  const load = useCallback(async (reason: string) => {
    if (!visibleRef.current && reason !== 'visible' && reason !== 'filters') return;
    if (inFlightRef.current) return;

    const ac = new AbortController();
    inFlightRef.current = ac;
    const applied = filtersRef.current;

    try {
      const res = await getHomeDashboard(applied);
      if (ac.signal.aborted) return;
      setData(res);
      setLoading(false);
      setError(null);
      backoffIdxRef.current = 0;
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      const msg =
        err instanceof ApiError && err.kind === 'unavailable'
          ? 'Service temporairement indisponible. Nouvelle tentative automatique.'
          : err instanceof Error
            ? err.message
            : 'Erreur de chargement';
      setError(msg);
      setLoading(false);

      const delay =
        err instanceof ApiError && err.kind === 'unavailable'
          ? (err.retryAfterSec ?? 60) * 1000
          : BACKOFF_MS[Math.min(backoffIdxRef.current, BACKOFF_MS.length - 1)];
      backoffIdxRef.current = Math.min(backoffIdxRef.current + 1, BACKOFF_MS.length - 1);
      if (backoffRef.current) clearTimeout(backoffRef.current);
      backoffRef.current = setTimeout(() => {
        void load('backoff');
      }, delay);
    } finally {
      if (inFlightRef.current === ac) inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    visibleRef.current = typeof document === 'undefined' || document.visibilityState !== 'hidden';

    void load('filters');

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (!cancelled && visibleRef.current) void load('poll');
    }, FALLBACK_POLL_MS);

    const onVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
      if (visibleRef.current) void load('visible');
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (backoffRef.current) clearTimeout(backoffRef.current);
      if (inFlightRef.current) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
      }
    };
  }, [filters, load]);

  const reset = useCallback(() => {
    setFilters(defaultFilters());
  }, [setFilters]);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    void load('refetch');
  }, [load]);

  return { data, loading, error, filters, setFilters, reset, refetch };
}
