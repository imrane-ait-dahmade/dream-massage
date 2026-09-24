'use client';

import { useEffect, useState } from 'react';
import { getBusinessTime } from '@/lib/api';
import { hasBusinessTimeTransitions, setBusinessTimeTransitions } from '@/lib/format';

/** Max wait for GET /api/time on a device with no cached offsets. */
const FIRST_LOAD_TIMEOUT_MS = 3000;

/**
 * Loads Morocco UTC offsets from the server before rendering, so times never
 * depend on the phone's (possibly outdated) timezone database.
 * With cached offsets the app renders immediately and refreshes in background.
 */
export function BusinessTimeSync({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    if (hasBusinessTimeTransitions()) markReady();
    const timeout = setTimeout(markReady, FIRST_LOAD_TIMEOUT_MS);

    getBusinessTime()
      .then((res) => setBusinessTimeTransitions(res.transitions))
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        markReady();
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        Chargement…
      </div>
    );
  }
  return <>{children}</>;
}
