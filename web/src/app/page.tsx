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
import { ShiftSummary } from '@/components/dashboard/ShiftSummary';
import { ConnectionStatusBar } from '@/components/dashboard/ConnectionStatus';
import { RevenueChart } from '@/components/dashboard/RevenueChart';
import { TotalsByChairTable } from '@/components/dashboard/TotalsByChairTable';
import { PrimeRevenueCard } from '@/components/dashboard/PrimeRevenueCard';
import { RecentSessionsTable } from '@/components/dashboard/RecentSessionsTable';

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-900">
      <div className="h-[49px] border-b border-white/10 bg-slate-900/95" />
      <main className="mx-auto max-w-6xl space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-xl bg-slate-800" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[90px] animate-pulse rounded-2xl bg-slate-800" />
          ))}
        </div>
      </main>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function DashboardContent() {
  const router = useRouter();

  const { state, connStatus, lastUpdated } = useDashboard();
  const { data, loading, error, filters, setFilters, reset, refetch } = useHomeDashboard();

  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    getMe().then(setUser).catch(() => {});
  }, []);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (!state) return <LoadingScreen />;

  // currentShift from REST API (more complete than socket's openShift)
  const currentShift = data?.currentShift ?? null;
  // openShift from socket — used as fallback for ShiftSummary
  const openShift = currentShift
    ? { id: currentShift.id, staffMemberName: currentShift.staffMemberName ?? '', startedAt: currentShift.startedAt }
    : state.openShift;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <DashboardHeader
        user={user}
        connStatus={connStatus}
        lastUpdated={lastUpdated}
        onLogout={() => void handleLogout()}
      />

      <main className="mx-auto max-w-6xl space-y-1.5 px-2 py-2 pb-3 md:space-y-3 md:px-4 md:py-3 md:pb-8">
        {/* Connection warning */}
        <ConnectionStatusBar status={connStatus} lastUpdated={lastUpdated} />

        {/* ── Top strip: shift status + filters ────────────────────────────── */}
        <div className="flex flex-col gap-1.5 lg:flex-row lg:items-start lg:gap-3">
          <div className="shrink-0 lg:w-64">
            <ShiftSummary openShift={openShift} />
          </div>
          <div className="flex-1">
            <DashboardFilters
              filters={filters}
              filterOptions={data?.filterOptions}
              onChange={setFilters}
              onReset={reset}
              loading={loading}
            />
          </div>
        </div>

        {/* ── Live chairs — 5 across on all screens ─────────────────────────── */}
        <div>
          <p className="mb-1 hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600 md:block md:text-[10px]">
            Fauteuils en temps réel
          </p>
          {state.chairs.length === 0 ? (
            <p className="rounded-xl border border-slate-700 bg-slate-800/40 py-3 text-center text-xs text-slate-600 md:py-5 md:text-sm">
              Aucun fauteuil configuré.
            </p>
          ) : (
            <div className="grid grid-cols-5 gap-1 md:gap-2">
              {state.chairs.map((chair) => (
                <ChairCard key={chair.id} chair={chair} compact />
              ))}
            </div>
          )}
        </div>

        {/* API error banner */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 md:px-4 md:py-3 md:text-sm">
            Erreur de chargement des données : {error}
          </div>
        )}

        {/* ── KPI summary cards ──────────────────────────────────────────────── */}
        <DashboardSummaryCards summary={data?.summary} loading={loading} />

        {/* ── Revenue chart + Prime breakdown ───────────────────────────────── */}
        <div className="grid grid-cols-1 gap-1.5 md:gap-3 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <RevenueChart data={data?.revenueChart} loading={loading} />
          </div>
          <div className="lg:col-span-2">
            <PrimeRevenueCard data={data?.primeRevenue} loading={loading} />
          </div>
        </div>

        {/* ── Totals by chair + Recent sessions ─────────────────────────────── */}
        <div className="grid grid-cols-1 gap-1.5 md:gap-3 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <TotalsByChairTable data={data?.totalsByChair} loading={loading} />
          </div>
          <div className="lg:col-span-3">
            <RecentSessionsTable
              sessions={data?.recentSessions}
              loading={loading}
              onCorrect={refetch}
            />
          </div>
        </div>

        {lastUpdated && (
          <p className="text-center text-[10px] text-slate-700 md:text-[11px]">
            Mis à jour :{' '}
            {lastUpdated.toLocaleTimeString('fr-FR', {
              hour:   '2-digit',
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
