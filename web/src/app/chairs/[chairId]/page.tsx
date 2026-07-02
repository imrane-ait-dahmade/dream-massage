'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Activity,
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { getChairOverview } from '@/lib/api';
import type {
  ChairOverview,
  ChairDetailStats,
  ChairRecentSession,
  ChairEvent,
  DashboardState,
  ChairStatus,
} from '@/lib/types';
import { getStatusLabel, getStatusStyle } from '@/lib/status';
import { formatDH, formatElapsed, formatTimeHHMM } from '@/lib/format';
import { createSocket } from '@/lib/socket';
import { AuthGuard } from '@/components/AuthGuard';

// ── Local helpers ──────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds === 0) return '—';
  if (seconds < 60) return `${seconds} s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

const EVENT_LABELS: Record<string, string> = {
  DEVICE_OFFLINE: 'Appareil hors ligne',
  DEVICE_ONLINE: 'Appareil en ligne',
  SESSION_START_DETECTED: 'Démarrage détecté',
  SESSION_CONFIRMED: 'Session confirmée',
  SESSION_END_DETECTED: 'Fin détectée',
  SESSION_COMPLETED: 'Session terminée',
  SESSION_UNCERTAIN: 'Session incertaine',
  STATE_CHANGED: "Changement d'état",
  OFFLINE: 'Hors ligne',
  ONLINE: 'En ligne',
  ERROR: 'Erreur',
};

const SESSION_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  ACTIVE: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Active' },
  COMPLETED: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Terminée' },
  UNCERTAIN: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Incertaine' },
  CANCELLED: { bg: 'bg-stone-100', text: 'text-stone-500', label: 'Annulée' },
  ERROR: { bg: 'bg-red-50', text: 'text-red-600', label: 'Erreur' },
};

// ── Tiny reusable components ───────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-stone-400">
      {children}
    </h2>
  );
}

function StatusBadge({ status }: { status: ChairStatus }) {
  const style = getStatusStyle(status);
  const label = getStatusLabel(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot} ${style.pulse ? 'animate-pulse' : ''}`}
      />
      {label}
    </span>
  );
}

function SessionBadge({ status }: { status: string }) {
  const c = SESSION_STATUS[status] ?? SESSION_STATUS.UNCERTAIN;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const startMs = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="font-mono font-semibold text-blue-600">{formatElapsed(elapsed)}</span>;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-100">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p className="mt-1 text-xl font-bold leading-tight text-stone-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

function EventIcon({ type }: { type: string }) {
  if (type === 'DEVICE_OFFLINE' || type === 'OFFLINE' || type === 'ERROR') {
    return <WifiOff className="h-3.5 w-3.5 text-red-500" />;
  }
  if (type === 'DEVICE_ONLINE' || type === 'ONLINE') {
    return <Wifi className="h-3.5 w-3.5 text-emerald-500" />;
  }
  if (type === 'SESSION_COMPLETED') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  }
  if (type === 'SESSION_UNCERTAIN') {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  }
  return <Activity className="h-3.5 w-3.5 text-stone-400" />;
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3.5">
          <div className="h-9 w-9 animate-pulse rounded-xl bg-stone-200" />
          <div className="flex-1 space-y-1.5">
            <div className="h-5 w-24 animate-pulse rounded-lg bg-stone-200" />
            <div className="h-3 w-32 animate-pulse rounded bg-stone-100" />
          </div>
          <div className="h-6 w-20 animate-pulse rounded-full bg-stone-100" />
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5">
        <div className="h-32 animate-pulse rounded-2xl bg-stone-200" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-200" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-200" />
          ))}
        </div>
        <div className="h-52 animate-pulse rounded-2xl bg-stone-200" />
        <div className="h-36 animate-pulse rounded-2xl bg-stone-200" />
      </main>
    </div>
  );
}

// ── Error screen ───────────────────────────────────────────────────────────────

function ErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-stone-100">
        <AlertTriangle className="mx-auto h-10 w-10 text-orange-400" />
        <p className="mt-3 text-sm font-medium text-stone-800">{error}</p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Réessayer
        </button>
        <div className="mt-3">
          <Link href="/" className="text-sm text-stone-400 transition-colors hover:text-stone-600">
            ← Tableau de bord
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Section: current status ────────────────────────────────────────────────────

function CurrentStatusCard({ chair }: { chair: ChairOverview['chair'] }) {
  const style = getStatusStyle(chair.status);
  const isRunning = chair.status === 'ACTIVE' || chair.status === 'MAYBE_FINISHED';

  return (
    <div className={`overflow-hidden rounded-2xl border border-stone-100 border-l-4 bg-white shadow-sm ${style.accent}`}>
      <div className="p-4">
        {/* Power + connectivity */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-stone-400" />
            <span className="text-2xl font-bold text-stone-900">{chair.powerWatts.toFixed(1)}</span>
            <span className="text-sm font-medium text-stone-400">W</span>
          </div>
          <div className="flex items-center gap-1.5">
            {chair.isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-600">En ligne</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-red-400" />
                <span className="text-xs font-medium text-red-500">Hors ligne</span>
              </>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div className="mt-3">
          <StatusBadge status={chair.status} />
        </div>

        {/* Active session timer */}
        {chair.currentSession && isRunning && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-blue-50 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs text-blue-600">
                Démarré à {chair.currentSession.startedAtLabel}
              </span>
            </div>
            <LiveTimer startedAt={chair.currentSession.startedAt} />
          </div>
        )}

        {/* Last sync */}
        {chair.lastSyncedAt && (
          <p className="mt-2 text-xs text-stone-400">
            Dernière sync. : {formatTimeHHMM(chair.lastSyncedAt)}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Section: stats grid (shared today + month) ─────────────────────────────────

function StatsGrid({ stats, period }: { stats: ChairDetailStats; period: 'today' | 'month' }) {
  const sessionSub =
    stats.sessionsCount > 0
      ? stats.activeSessionsCount > 0
        ? `${stats.completedSessionsCount} terminée${stats.completedSessionsCount !== 1 ? 's' : ''} · ${stats.activeSessionsCount} active`
        : `${stats.completedSessionsCount} terminée${stats.completedSessionsCount !== 1 ? 's' : ''}`
      : undefined;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label={period === 'today' ? "Sessions auj." : "Sessions"}
        value={String(stats.sessionsCount)}
        sub={sessionSub}
      />
      <StatCard
        label={period === 'today' ? "Revenu auj." : "Revenu"}
        value={formatDH(stats.finalRevenue)}
      />
      <StatCard
        label="Temps total"
        value={formatDuration(stats.totalDurationSeconds)}
      />
      <StatCard
        label="Durée moyenne"
        value={formatDuration(stats.averageDurationSeconds)}
        sub="par session"
      />
    </div>
  );
}

// ── Section: recent sessions list ─────────────────────────────────────────────

function SessionsList({ sessions }: { sessions: ChairRecentSession[] }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-sm ring-1 ring-stone-100">
        <p className="text-sm text-stone-400">Aucune session pour cette période</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-100">
      <ul className="divide-y divide-stone-100">
        {sessions.map((s) => (
          <li key={s.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              {/* Time + duration + plan name */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-900">
                  {formatTimeHHMM(s.startedAt)}
                  {s.endedAt ? ` → ${formatTimeHHMM(s.endedAt)}` : ''}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-400">
                  {s.durationSeconds !== null && <span>{formatDuration(s.durationSeconds)}</span>}
                  {s.matchedPlanName && (
                    <>
                      <span className="text-stone-200">·</span>
                      <span>{s.matchedPlanName}</span>
                    </>
                  )}
                </div>
              </div>
              {/* Amount + status badge */}
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-sm font-semibold text-stone-900">
                  {s.finalAmount !== null ? formatDH(s.finalAmount) : '—'}
                </span>
                <SessionBadge status={s.status} />
              </div>
            </div>
            {/* Anomaly indicator */}
            {s.anomalyType && (
              <div className="mt-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-orange-500" />
                <span className="text-xs text-orange-600">{s.anomalyType}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Section: events list ───────────────────────────────────────────────────────

function EventsList({ events }: { events: ChairEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-sm ring-1 ring-stone-100">
        <p className="text-sm text-stone-400">Aucun événement récent</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-100">
      <ul className="divide-y divide-stone-100">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-3 px-4 py-3">
            {/* Icon bubble */}
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-50 ring-1 ring-stone-100">
              <EventIcon type={e.eventType} />
            </div>
            {/* Text */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-stone-900">
                  {EVENT_LABELS[e.eventType] ?? e.eventType}
                </span>
                <span className="shrink-0 text-xs text-stone-400">
                  {formatTimeHHMM(e.createdAt)}
                </span>
              </div>
              {e.message && (
                <p className="mt-0.5 truncate text-xs text-stone-400">{e.message}</p>
              )}
              {e.powerWatts !== null && (
                <p className="mt-0.5 text-xs text-stone-400">{e.powerWatts.toFixed(1)} W</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function ChairDetailContent() {
  const params = useParams();
  const chairId =
    typeof params.chairId === 'string' ? params.chairId : String(params.chairId ?? '');

  const [overview, setOverview] = useState<ChairOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const data = await getChairOverview(chairId);
      setOverview(data);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg === 'CHAIR_NOT_FOUND'
          ? 'Fauteuil introuvable.'
          : 'Impossible de charger les données du fauteuil.',
      );
    } finally {
      setLoading(false);
    }
  }, [chairId]);

  // Initial load + 15-second background refresh
  useEffect(() => {
    void fetchOverview();
    const id = setInterval(() => { void fetchOverview(); }, 15_000);
    return () => clearInterval(id);
  }, [fetchOverview]);

  // WebSocket: patch live chair status from dashboard broadcasts
  useEffect(() => {
    const socket = createSocket();

    socket.on('dashboard:update', (state: DashboardState) => {
      setOverview((prev) => {
        if (!prev) return prev;
        const live = state.chairs.find((c) => c.id === prev.chair.id);
        if (!live) return prev;
        return {
          ...prev,
          chair: {
            ...prev.chair,
            status: live.status,
            powerWatts: live.powerWatts,
            isOnline: live.isOnline,
            currentSession: live.sessionStartedAt
              ? {
                  id: prev.chair.currentSession?.id ?? '',
                  startedAt: live.sessionStartedAt,
                  elapsedSeconds: live.elapsedSeconds,
                  startedAtLabel: new Date(live.sessionStartedAt).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                }
              : null,
          },
        };
      });
    });

    return () => { socket.disconnect(); };
  }, []);

  if (loading) return <LoadingScreen />;
  if (error) {
    return (
      <ErrorScreen
        error={error}
        onRetry={() => {
          setLoading(true);
          void fetchOverview();
        }}
      />
    );
  }
  if (!overview) return null;

  const { chair, today, month, recentSessions, events } = overview;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3.5">
          {/* Back to dashboard */}
          <Link
            href="/"
            className="flex items-center justify-center rounded-xl p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
            aria-label="Retour au tableau de bord"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>

          {/* Chair identity */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-bold text-stone-900">{chair.name}</h1>
              {chair.displayName && (
                <span className="truncate text-sm text-stone-400">{chair.displayName}</span>
              )}
            </div>
            <p className="text-xs text-stone-400">Détail du fauteuil</p>
          </div>

          {/* Live status indicators */}
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={chair.status} />
            {chair.isOnline ? (
              <Wifi className="h-4 w-4 text-emerald-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-400" />
            )}
          </div>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5 pb-10">
        {/* Current live status */}
        <CurrentStatusCard chair={chair} />

        {/* Today stats */}
        <section>
          <SectionTitle>{"Aujourd'hui"}</SectionTitle>
          <StatsGrid stats={today} period="today" />
        </section>

        {/* Month stats */}
        <section>
          <SectionTitle>Ce mois</SectionTitle>
          <StatsGrid stats={month} period="month" />
        </section>

        {/* Recent sessions */}
        <section>
          <SectionTitle>{"Dernières sessions"}</SectionTitle>
          <SessionsList sessions={recentSessions} />
        </section>

        {/* Chair events */}
        <section>
          <SectionTitle>{"Derniers événements"}</SectionTitle>
          <EventsList events={events} />
        </section>
      </main>
    </div>
  );
}

export default function ChairDetailPage() {
  return (
    <AuthGuard allowedRoles={['OWNER', 'ADMIN']} wrongRolePath="/assistant">
      <ChairDetailContent />
    </AuthGuard>
  );
}
