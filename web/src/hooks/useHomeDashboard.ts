'use client';

import { useState, useEffect, useCallback } from 'react';
import { getHomeDashboard } from '@/lib/api';
import type { HomeDashboardFilters, HomeDashboardResponse } from '@/lib/types';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultFilters(): HomeDashboardFilters {
  const today = todayISO();
  return { from: today, to: today, period: 'all', chair: 'all', chartPeriod: 'day' };
}

export function useHomeDashboard() {
  // Separate "applied" filters (what the effect uses) from the public setter
  const [filters, _setFiltersInternal] = useState<HomeDashboardFilters>(defaultFilters());
  const [data, setData] = useState<HomeDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true); // true from initial load
  const [error, setError] = useState<string | null>(null);

  // Wrapped setter — marks loading before changing filters so the spinner shows immediately.
  // Must NOT be called from inside useEffect (only from event handlers / user interactions).
  const setFilters = useCallback((update: HomeDashboardFilters | ((prev: HomeDashboardFilters) => HomeDashboardFilters)) => {
    setLoading(true);
    setError(null);
    _setFiltersInternal(update);
  }, []);

  // Fetch whenever applied filters change.
  // No setState calls in the effect body — only inside callbacks.
  useEffect(() => {
    let cancelled = false;

    getHomeDashboard(filters)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erreur de chargement');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters]);

  const reset = useCallback(() => {
    setFilters(defaultFilters());
  }, [setFilters]);

  return { data, loading, error, filters, setFilters, reset };
}
