'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/hooks/useDashboard';
import { logout, getMe, type AuthUser } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { DashboardFilters } from '@/components/dashboard/DashboardFilters';
import { TodayStats } from '@/components/dashboard/TodayStats';
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
      {/* Nav placeholder */}
      <div className="h-[57px] border-b border-white/10 bg-slate-900/95" />
      {/* Hero placeholder */}
      <div className="h-36 bg-slate-800/40" />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        {/* Filters skeleton */}
        <div className="h-16 animate-pulse rounded-2xl bg-slate-800/60" />
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-2xl bg-slate-800" />
          ))}
        </div>
        {/* Chairs skeleton */}
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
  const { state, connStatus, lastUpdated } = useDashboard();
  const [user, setUser] = useState<AuthUser | null>(null);

  // Fetch current user for role badge — AuthGuard already verified auth, this is non-critical
  useEffect(() => {
    getMe().then(setUser).catch(() => {});
  }, []);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (!state) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* ── App shell: nav + hero ───────────────────────────────────────────── */}
      <DashboardHeader
        user={user}
        connStatus={connStatus}
        lastUpdated={lastUpdated}
        onLogout={() => void handleLogout()}
      />

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 pb-14">
        {/* Connection warning banner (hidden when connected) */}
        <ConnectionStatusBar status={connStatus} lastUpdated={lastUpdated} />

        {/* Filters */}
        <DashboardFilters />

        {/* Today KPI cards */}
        <section>
          <SectionLabel>Aujourd&apos;hui</SectionLabel>
          <TodayStats stats={state.todayStats} />
        </section>

        {/* Active shift */}
        <ShiftSummary openShift={state.openShift} />

        {/* Live chair grid */}
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

        {/* Revenue chart — live from /api/dashboard/revenue-stats */}
        <section>
          <SectionLabel>Statistiques de revenu</SectionLabel>
          <RevenueChart />
        </section>

        {/* Totals by chair — placeholder, needs report endpoint */}
        <section>
          <SectionLabel>Totaux par fauteuil</SectionLabel>
          <TotalsByChairTable />
        </section>

        {/* Primes & Recettes — placeholder */}
        <section>
          <SectionLabel>Primes &amp; Recettes</SectionLabel>
          <PrimeRevenueCard />
        </section>

        {/* Recent sessions — placeholder, needs global report endpoint */}
        <section>
          <SectionLabel>Sessions récentes</SectionLabel>
          <RecentSessionsTable />
        </section>

        {/* Footer timestamp */}
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
