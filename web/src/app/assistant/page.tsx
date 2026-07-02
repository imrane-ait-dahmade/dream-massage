'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  LogOut,
  Clock,
  Banknote,
  Sparkles,
  Target,
  Gift,
  ListChecks,
} from 'lucide-react';
import { AuthGuard } from '@/components/AuthGuard';
import {
  getAssistantToday,
  logout,
} from '@/lib/api';
import type {
  AssistantDashboardResponse,
  AssistantSessionRow,
} from '@/lib/types';
import { formatDH, formatElapsed, formatTimeHHMM } from '@/lib/format';

function billingLabel(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'En attente',
    CALCULATED: 'Calculé',
    CORRECTED: 'Corrigé',
    DISPUTED: 'Litige',
  };
  return map[status] ?? status;
}

function SessionRow({ session }: { session: AssistantSessionRow }) {
  const corrected = session.billingStatus === 'CORRECTED';
  const outOfRule = !!session.anomalyType;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-stone-900">{session.chairName}</p>
          <p className="text-xs text-stone-500">
            {formatTimeHHMM(session.startedAt)}
            {session.endedAt ? ` → ${formatTimeHHMM(session.endedAt)}` : ' → en cours'}
          </p>
        </div>
        <p className="text-sm font-bold text-stone-900">{formatDH(session.finalAmount)}</p>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-600">
        {session.durationSeconds != null && (
          <span className="rounded-md bg-stone-100 px-2 py-0.5">
            {formatElapsed(session.durationSeconds)}
          </span>
        )}
        {session.matchedPlanName && (
          <span className="rounded-md bg-stone-100 px-2 py-0.5">{session.matchedPlanName}</span>
        )}
        <span
          className={`rounded-md px-2 py-0.5 ${
            corrected ? 'bg-amber-100 text-amber-800' : 'bg-stone-100'
          }`}
        >
          {billingLabel(session.billingStatus)}
        </span>
        {outOfRule && (
          <span className="rounded-md bg-orange-100 px-2 py-0.5 text-orange-800">Hors règle</span>
        )}
      </div>

      {corrected && (
        <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          <p>
            Montant initial : {formatDH(session.expectedAmount)} → corrigé :{' '}
            {formatDH(session.finalAmount)}
          </p>
          {session.correctionReason && (
            <p className="mt-1 text-amber-800">Motif : {session.correctionReason}</p>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 ${
        highlight
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-stone-200 bg-white'
      }`}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-stone-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-800' : 'text-stone-900'}`}>
        {value}
      </p>
    </div>
  );
}

function AssistantContent() {
  const router = useRouter();
  const [data, setData] = useState<AssistantDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAssistantToday()
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-400">Chargement…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-stone-50 px-4">
        <p className="text-sm text-red-600">{error ?? 'Données indisponibles'}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const { summary, currentShift, sessions, alerts, staffMember, date } = data;

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Dream Care</p>
            <h1 className="text-base font-bold text-stone-900">Mon shift</h1>
            <p className="text-xs text-stone-500">{staffMember.name} · {date}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            Déconnexion
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-4 pb-8">
        {/* Current shift */}
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
            <Clock className="h-4 w-4 text-stone-500" />
            Shift du jour
          </div>
          {currentShift ? (
            <div className="space-y-1 text-sm text-stone-700">
              <p>
                <span className="font-medium">{currentShift.shiftTypeLabel ?? 'Shift'}</span>
                {' · '}
                <span
                  className={
                    currentShift.status === 'OPEN'
                      ? 'font-medium text-emerald-700'
                      : 'text-stone-600'
                  }
                >
                  {currentShift.status === 'OPEN' ? 'Ouvert' : currentShift.status}
                </span>
              </p>
              <p className="text-xs text-stone-500">
                Début {formatTimeHHMM(currentShift.startedAt)}
                {currentShift.scheduledEndAt &&
                  ` · fin prévue ${formatTimeHHMM(currentShift.scheduledEndAt)}`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-stone-500">Aucun shift ouvert pour le moment.</p>
          )}
        </section>

        {/* Summary */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-stone-800">Résumé du jour</h2>
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard label="Total brut" value={formatDH(summary.grossRevenue)} icon={Banknote} />
            <SummaryCard
              label="Prime par plan"
              value={formatDH(summary.planCommission)}
              icon={Sparkles}
            />
            <SummaryCard
              label="Bonus objectif"
              value={formatDH(summary.targetBonus)}
              icon={Target}
            />
            <SummaryCard
              label="Bonus manuel"
              value={formatDH(summary.manualBonus)}
              icon={Gift}
            />
            <SummaryCard
              label="Prime totale"
              value={formatDH(summary.totalPrime)}
              icon={Sparkles}
              highlight
            />
            <SummaryCard
              label="Sessions"
              value={String(summary.sessionsCount)}
              icon={ListChecks}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-xl bg-stone-100 px-2 py-2 text-stone-600">
              À vérifier : <span className="font-semibold">{summary.pendingSessionsCount}</span>
            </div>
            <div className="rounded-xl bg-stone-100 px-2 py-2 text-stone-600">
              Hors règle : <span className="font-semibold">{summary.outOfRuleSessionsCount}</span>
            </div>
          </div>
        </section>

        {/* Alerts */}
        {alerts.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-stone-800">Alertes</h2>
            {alerts.map((alert, i) => (
              <div
                key={`${alert.type}-${alert.sessionId ?? i}`}
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs font-medium text-amber-900">{alert.message}</p>
              </div>
            ))}
          </section>
        )}

        {/* Sessions */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-stone-800">
            Sessions ({sessions.length})
          </h2>
          {sessions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-400">
              Aucune session aujourd&apos;hui.
            </p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default function AssistantPage() {
  return (
    <AuthGuard allowedRoles={['ASSISTANT']} wrongRolePath="/">
      <AssistantContent />
    </AuthGuard>
  );
}
