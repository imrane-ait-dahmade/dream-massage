'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Settings, LogOut } from 'lucide-react';
import type { SettingsChair, PricingPlan, StaffMember, SystemSettings, SettingsUser } from '@/lib/types';
import {
  getSettingsChairs,
  getPricingPlans,
  getStaffMembers,
  getSystemSettings,
  getSettingsUsers,
} from '@/lib/api';
import { ChairSettingsCard } from '@/components/settings/ChairSettingsCard';
import { PricingPlansSettings } from '@/components/settings/PricingPlansSettings';
import { StaffSettings } from '@/components/settings/StaffSettings';
import { SystemSettingsPanel } from '@/components/settings/SystemSettings';
import { PrimeBonusSettings } from '@/components/settings/PrimeBonusSettings';
import { ShiftPlanningSettings } from '@/components/settings/ShiftPlanningSettings';
import { SessionSettingsPanel } from '@/components/settings/SessionSettingsPanel';
import { UsersAccessSection } from '@/components/settings/UsersAccessSection';
import { AuthGuard } from '@/components/AuthGuard';
import { logout } from '@/lib/api';

// ── Tabs ───────────────────────────────────────────────────────────────────────

type Tab = 'fauteuils' | 'prix' | 'staff' | 'systeme' | 'primes' | 'planning' | 'sessions' | 'utilisateurs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'fauteuils',    label: 'Fauteuils' },
  { id: 'prix',         label: 'Prix & plans' },
  { id: 'staff',        label: 'Staff' },
  { id: 'systeme',      label: 'Système' },
  { id: 'primes',       label: 'Primes & Bonus' },
  { id: 'planning',     label: 'Shifts & Planning' },
  { id: 'sessions',     label: 'Sessions' },
  { id: 'utilisateurs', label: 'Utilisateurs & Accès' },
];

// ── Data ───────────────────────────────────────────────────────────────────────

interface SettingsData {
  chairs: SettingsChair[];
  plans:  PricingPlan[];
  staff:  StaffMember[];
  system: SystemSettings;
  users:  SettingsUser[];
}

// ── Loading / error screens ────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <div className="h-5 w-5 animate-pulse rounded bg-stone-200" />
          <div className="h-6 w-40 animate-pulse rounded-lg bg-stone-200" />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-stone-200" />
        ))}
      </main>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-stone-50">
      <PageHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-stone-500">{message}</p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white"
        >
          <RefreshCw className="h-4 w-4" />
          Réessayer
        </button>
      </main>
    </div>
  );
}

function PageHeader() {
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3.5">
        <Link href="/" className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex flex-1 items-center gap-2">
          <Settings className="h-4 w-4 text-stone-400" />
          <h1 className="text-base font-bold text-stone-900">Paramétrages</h1>
        </div>
        <button
          onClick={() => void handleLogout()}
          className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          title="Déconnexion"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

// ── Tab bar ────────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="sticky top-[57px] z-10 border-b border-stone-200 bg-white">
      <div className="mx-auto max-w-2xl">
        <div className="flex overflow-x-auto px-4 scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`shrink-0 border-b-2 px-3.5 py-3 text-xs font-semibold transition-colors ${
                active === tab.id
                  ? 'border-stone-900 text-stone-900'
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-stone-400">{title}</h2>
      {children}
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

function SettingsContent() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('fauteuils');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chairsRes, plansRes, staffRes, systemRes, usersRes] = await Promise.all([
        getSettingsChairs(),
        getPricingPlans(),
        getStaffMembers(),
        getSystemSettings(),
        getSettingsUsers(),
      ]);
      setData({
        chairs: chairsRes.items,
        plans:  plansRes.items,
        staff:  staffRes.items,
        system: systemRes,
        users:  usersRes.items,
      });
    } catch (e) {
      setError((e as Error).message || 'Impossible de charger les paramètres.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <LoadingScreen />;
  if (error && !data) return <ErrorScreen message={error} onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="min-h-screen bg-stone-50">
      <PageHeader />
      <TabBar active={activeTab} onChange={setActiveTab} />

      <main className="mx-auto max-w-2xl px-4 py-5 pb-12">
        {/* Refreshing indicator */}
        {loading && (
          <div className="mb-3 flex items-center gap-1.5 text-xs text-stone-400">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Actualisation…
          </div>
        )}

        {/* ── Fauteuils ──────────────────────────────────────────────────────── */}
        {activeTab === 'fauteuils' && (
          <Section title="Fauteuils">
            {data.chairs.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-400">Aucun fauteuil configuré.</p>
            ) : (
              <div className="space-y-3">
                {data.chairs.map((chair) => (
                  <ChairSettingsCard key={chair.id} chair={chair} onSaved={() => void load()} />
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Prix & plans ───────────────────────────────────────────────────── */}
        {activeTab === 'prix' && (
          <Section title="Plans tarifaires">
            <PricingPlansSettings plans={data.plans} onSaved={() => void load()} />
          </Section>
        )}

        {/* ── Staff ──────────────────────────────────────────────────────────── */}
        {activeTab === 'staff' && (
          <Section title="Assistantes">
            <StaffSettings members={data.staff} onSaved={() => void load()} />
          </Section>
        )}

        {/* ── Système ────────────────────────────────────────────────────────── */}
        {activeTab === 'systeme' && (
          <Section title="Informations système">
            <SystemSettingsPanel info={data.system} />
          </Section>
        )}

        {/* ── Primes & Bonus ──────────────────────────────────────────────────── */}
        {activeTab === 'primes' && (
          <Section title="Primes & Bonus">
            <PrimeBonusSettings />
          </Section>
        )}

        {/* ── Shifts & Planning ───────────────────────────────────────────────── */}
        {activeTab === 'planning' && (
          <Section title="Shifts & Planning">
            <ShiftPlanningSettings />
          </Section>
        )}

        {/* ── Sessions ────────────────────────────────────────────────────────── */}
        {activeTab === 'sessions' && (
          <Section title="Paramétrage sessions">
            <SessionSettingsPanel />
          </Section>
        )}

        {/* ── Utilisateurs & Accès ───────────────────────────────────────────── */}
        {activeTab === 'utilisateurs' && (
          <Section title="Utilisateurs & Accès">
            <UsersAccessSection users={data.users} staffMembers={data.staff} onSaved={() => void load()} />
          </Section>
        )}
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard allowedRoles={['OWNER', 'ADMIN']} wrongRolePath="/assistant">
      <SettingsContent />
    </AuthGuard>
  );
}
