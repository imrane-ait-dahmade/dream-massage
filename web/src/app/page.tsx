'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, WifiOff } from 'lucide-react';
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
      <div className="h-[53px] border-b border-white/10 bg-slate-900/95" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-[100px] animate-pulse rounded-2xl bg-slate-800" />
          ))}
        </div>
        <div className="h-[80px] animate-pulse rounded-2xl bg-slate-800" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[100px] animate-pulse rounded-2xl bg-slate-800" />
          ))}
        </div>
      </main>
    </div>
  );
}

// ── Alerts section ────────────────────────────────────────────────────────────

interface AlertsProps {
  offlineChairs:      number;
  outOfRuleSessions:  number;
  noOpenShift:        boolean;
  hasSessions:        boolean;
}

function AlertsSection({ offlineChairs, outOfRuleSessions, noOpenShift, hasSessions }: AlertsProps) {
  const alerts: { key: string; msg: string; cls: string }[] = [];

  if (offlineChairs > 0)
    alerts.push({ key: 'offline', msg: `${offlineChairs} fauteuil${offlineChairs > 1 ? 's' : ''} hors ligne`, cls: 'text-red-400' });
  if (outOfRuleSessions > 0)
    alerts.push({ key: 'rule', msg: `${outOfRuleSessions} session${outOfRuleSessions > 1 ? 's' : ''} hors règle`, cls: 'text-orange-400' });
  if (noOpenShift && hasSessions)
    alerts.push({ key: 'shift', msg: 'Sessions en cours sans shift actif', cls: 'text-amber-400' });

  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {alerts.map((a) => (
        <div key={a.key} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">
          <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${a.cls}`} />
          <span className={`text-xs font-medium ${a.cls}`}>{a.msg}</span>
        </div>
      ))}
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

  const currentShift = data?.currentShift ?? null;
  const openShift = currentShift
    ? { id: currentShift.id, staffMemberName: currentShift.staffMemberName ?? '', startedAt: currentShift.startedAt }
    : state.openShift;

  const hasOpenShift = !!(currentShift ?? openShift);
  const activeSessions = data?.summary?.activeSessionsCount ?? state.todayStats.activeChairs;
  const offlineChairs  = data?.summary?.offlineChairs ?? state.todayStats.offlineChairs;
  const outOfRuleSessions = data?.summary?.outOfRuleSessionsCount ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* ── 1. Header ──────────────────────────────────────────────────────── */}
      <DashboardHeader
        user={user}
        connStatus={connStatus}
        lastUpdated={lastUpdated}
        onLogout={() => void handleLogout()}
      />

      <main className="mx-auto max-w-6xl space-y-4 px-3 py-4 md:px-4 md:py-5">
        {/* Connection warning */}
        <ConnectionStatusBar status={connStatus} lastUpdated={lastUpdated} />

        {/* ── 2. Summary KPI cards ─────────────────────────────────────────── */}
        <DashboardSummaryCards summary={data?.summary} loading={loading} />

        {/* ── 3. Current shift card ────────────────────────────────────────── */}
        <ShiftSummary currentShift={currentShift} openShift={openShift} />

        {/* ── 4. Alerts ────────────────────────────────────────────────────── */}
        <AlertsSection
          offlineChairs={offlineChairs}
          outOfRuleSessions={outOfRuleSessions}
          noOpenShift={!hasOpenShift}
          hasSessions={activeSessions > 0}
        />

        {/* API error banner */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <WifiOff className="h-4 w-4 shrink-0 text-red-400" />
            <span className="text-sm text-red-400">Erreur de chargement des données : {error}</span>
          </div>
        )}

        {/* ── 5. Filters ───────────────────────────────────────────────────── */}
        <DashboardFilters
          filters={filters}
          filterOptions={data?.filterOptions}
          onChange={setFilters}
          onReset={reset}
          loading={loading}
        />

        {/* ── 6. Live chairs ──────────────────────────────────────────────── */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-600">
            Fauteuils en temps réel
          </p>
          {state.chairs.length === 0 ? (
            <p className="rounded-2xl border border-slate-700 bg-slate-800/40 py-6 text-center text-sm text-slate-600">
              Aucun fauteuil configuré.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {state.chairs.map((chair) => (
                <ChairCard key={chair.id} chair={chair} compact />
              ))}
            </div>
          )}
        </div>

        {/* ── 7. Revenue chart ────────────────────────────────────────────── */}
        <RevenueChart data={data?.revenueChart} loading={loading} />

        {/* ── 8. Primes & Recettes ────────────────────────────────────────── */}
        <PrimeRevenueCard data={data?.primeRevenue} loading={loading} />

        {/* ── 9. Totaux par fauteuil ──────────────────────────────────────── */}
        <TotalsByChairTable data={data?.totalsByChair} loading={loading} />

        {/* ── 10. Recent sessions ─────────────────────────────────────────── */}
        <RecentSessionsTable
          sessions={data?.recentSessions}
          loading={loading}
          onCorrect={refetch}
        />

        {lastUpdated && (
          <p className="pb-4 text-center text-[11px] text-slate-700">
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
