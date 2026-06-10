'use client';

import { Wifi, WifiOff, RefreshCw, Settings } from 'lucide-react';
import Link from 'next/link';
import { useDashboard } from '@/hooks/useDashboard';
import { TodayStats } from '@/components/dashboard/TodayStats';
import { ChairCard } from '@/components/dashboard/ChairCard';
import { ChairCardSkeleton } from '@/components/dashboard/ChairCardSkeleton';
import { ShiftSummary } from '@/components/dashboard/ShiftSummary';
import { ConnectionStatusBar } from '@/components/dashboard/ConnectionStatus';

// ── Loading state ─────────────────────────────────────────────────────────────

function StatSkeleton() {
  return <div className="h-[104px] animate-pulse rounded-2xl bg-stone-200" />;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-stone-50">
      {/* Fake header */}
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <div className="h-6 w-36 animate-pulse rounded-lg bg-stone-200" />
            <div className="mt-1 h-3.5 w-48 animate-pulse rounded bg-stone-100" />
          </div>
          <div className="h-7 w-24 animate-pulse rounded-full bg-stone-100" />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {/* Stats skeletons */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
        {/* Shift skeleton */}
        <div className="h-16 animate-pulse rounded-2xl bg-stone-200" />
        {/* Chair skeletons */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <ChairCardSkeleton key={i} />
          ))}
        </div>
      </main>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { state, connStatus, lastUpdated } = useDashboard();

  if (!state) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5">
          {/* Branding */}
          <div>
            <h1 className="text-lg font-bold leading-tight text-stone-900">Dream Massage</h1>
            <p className="text-xs text-stone-400">Suivi temps réel des fauteuils</p>
          </div>

          {/* Right side: settings link + connection badge */}
          <div className="flex items-center gap-2">
            <Link href="/settings" className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700" title="Paramétrages">
              <Settings className="h-4 w-4" />
            </Link>
            <ConnectionBadge status={connStatus} lastUpdated={lastUpdated} />
          </div>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5 pb-10">
        {/* Disconnected / recovery banner */}
        <ConnectionStatusBar status={connStatus} lastUpdated={lastUpdated} />

        {/* Today stats */}
        <section>
          <SectionTitle>Aujourd&apos;hui</SectionTitle>
          <TodayStats stats={state.todayStats} />
        </section>

        {/* Shift summary */}
        <section>
          <SectionTitle>Quart de travail</SectionTitle>
          <ShiftSummary openShift={state.openShift} />
        </section>

        {/* Chair cards */}
        <section>
          <SectionTitle>Fauteuils</SectionTitle>

          {state.chairs.length === 0 ? (
            <div className="rounded-2xl bg-white px-6 py-10 text-center shadow-sm ring-1 ring-stone-100">
              <p className="text-stone-400">Aucun fauteuil configuré.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.chairs.map((chair) => (
                <ChairCard key={chair.id} chair={chair} />
              ))}
            </div>
          )}
        </section>

        {/* Last updated footer */}
        {lastUpdated && (
          <p className="pt-2 text-center text-xs text-stone-400">
            Mis à jour :{' '}
            {lastUpdated.toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </p>
        )}
      </main>
    </div>
  );
}

// ── Small sub-components (page-level only) ───────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-stone-400">
      {children}
    </h2>
  );
}

function ConnectionBadge({
  status,
  lastUpdated,
}: {
  status: 'connecting' | 'connected' | 'disconnected';
  lastUpdated: Date | null;
}) {
  if (status === 'connected') {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <Wifi className="h-3.5 w-3.5" />
        <span>Connecté</span>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600 ring-1 ring-blue-200">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        <span>Connexion…</span>
      </div>
    );
  }

  // disconnected
  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-red-200">
        <WifiOff className="h-3.5 w-3.5" />
        <span>Déconnecté</span>
      </div>
      {lastUpdated && (
        <span className="text-xs text-stone-400">
          {lastUpdated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}
