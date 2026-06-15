'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/hooks/useDashboard';
import { useHomeDashboard } from '@/hooks/useHomeDashboard';
import { logout, getMe, type AuthUser } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { DashboardFilters } from '@/components/dashboard/DashboardFilters';
import { DashboardSummaryCards } from '@/components/dashboard/DashboardSummaryCards';
import { ChairCard } from '@/components/dashboard/ChairCard';
import { ChairCardSkeleton } from '@/components/dashboard/ChairCardSkeleton';
import { ShiftSummary } from '@/components/dashboard/ShiftSummary';
import { ConnectionStatusBar } from '@/components/dashboard/ConnectionStatus';
import { RevenueChart } from '@/components/dashboard/RevenueChart';
import { TotalsByChairTable } from '@/components/dashboard/TotalsByChairTable';
import { PrimeRevenueCard } from '@/components/dashboard/PrimeRevenueCard';
import { RecentSessionsTable } from '@/components/dashboard/RecentSessionsTable';

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="h-[57px] border-b border-white/10 bg-slate-900/95" />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <div className="h-20 animate-pulse rounded-2xl bg-slate-800/60" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-slate-800" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <ChairCardSkeleton key={i} />
          ))}
        </div>
      </main>
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
      {children}
    </h2>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function DashboardContent() {
  const router = useRouter();

  // Real-time chair grid + open shift + connection status
  const { state, connStatus, lastUpdated } = useDashboard();

  // Filtered analytics from /api/dashboard/home
  const { data, loading, error, filters, setFilters, reset } = useHomeDashboard();

  // Current user (non-critical, used only for role badge in header)
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    getMe().then(setUser).catch(() => {});
  }, []);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  // Show full-page skeleton until live state is ready
  if (!state) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <DashboardHeader
        user={user}
        connStatus={connStatus}
        lastUpdated={lastUpdated}
        onLogout={() => void handleLogout()}
      />

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 pb-14">
        {/* Connection warning */}
        <ConnectionStatusBar status={connStatus} lastUpdated={lastUpdated} />

        {/* ── Filters — drive all sections below ─────────────────────────── */}
        <DashboardFilters
          filters={filters}
          onChange={setFilters}
          onReset={reset}
          loading={loading}
        />

        {/* API error banner */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Erreur de chargement des données : {error}
          </div>
        )}

        {/* ── KPI summary cards — from home endpoint ──────────────────────── */}
        <section>
          <SectionLabel>Résumé de la période</SectionLabel>
          <DashboardSummaryCards summary={data?.summary} loading={loading} />
        </section>

        {/* ── Active shift ─────────────────────────────────────────────────── */}
        <ShiftSummary openShift={state.openShift} />

        {/* ── Live chair grid — real-time via WebSocket ───────────────────── */}
        <section>
          <SectionLabel>Fauteuils en temps réel</SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {state.chairs.map((chair) => (
              <ChairCard key={chair.id} chair={chair} />
            ))}
            {state.chairs.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-slate-600">
                Aucun fauteuil configuré.
              </p>
            )}
          </div>
        </section>

        {/* ── Revenue chart — from home endpoint ──────────────────────────── */}
        <section>
          <SectionLabel>Statistiques de revenu</SectionLabel>
          <RevenueChart data={data?.revenueChart} loading={loading} />
        </section>

        {/* ── Totals by chair — from home endpoint ────────────────────────── */}
        <section>
          <SectionLabel>Totaux par fauteuil</SectionLabel>
          <TotalsByChairTable data={data?.totalsByChair} loading={loading} />
        </section>

        {/* ── Primes & Recettes — from home endpoint ──────────────────────── */}
        <section>
          <SectionLabel>Primes &amp; Recettes</SectionLabel>
          <PrimeRevenueCard data={data?.primeRevenue} loading={loading} />
        </section>

        {/* ── Recent sessions — from home endpoint ────────────────────────── */}
        <section>
          <SectionLabel>Sessions récentes</SectionLabel>
          <RecentSessionsTable sessions={data?.recentSessions} loading={loading} />
        </section>

        {/* Footer timestamp from WebSocket */}
        {lastUpdated && (
          <p className="pt-2 text-center text-[11px] text-slate-700">
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

// ── Page export ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}
