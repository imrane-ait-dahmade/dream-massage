'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, RefreshCw, X } from 'lucide-react';
import { AuthGuard } from '@/components/AuthGuard';
import { PlanChangeReviewModal } from '@/components/dashboard/PlanChangeReviewModal';
import {
  getMe,
  listSessionPlanChangeRequests,
  logout,
  type AuthUser,
} from '@/lib/api';
import type {
  SessionPlanChangeRequest,
  SessionPlanChangeRequestStatus,
} from '@/lib/types';
import { formatDH } from '@/lib/format';
import {
  amountDiff,
  formatAmountDiff,
  formatPlanMinutes,
  planChangeStatusClass,
  planChangeStatusLabel,
} from '@/lib/plan-change';

type Filter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'PENDING', label: 'En attente' },
  { key: 'APPROVED', label: 'Validées' },
  { key: 'REJECTED', label: 'Refusées' },
  { key: 'ALL', label: 'Toutes' },
];

function PlanChangeRequestsContent() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [requests, setRequests] = useState<SessionPlanChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [review, setReview] = useState<{
    request: SessionPlanChangeRequest;
    mode: 'approve' | 'reject';
  } | null>(null);

  const isOwnerOrAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status =
        filter === 'ALL' ? undefined : (filter as SessionPlanChangeRequestStatus);
      const res = await listSessionPlanChangeRequests({ status, limit: 100 });
      setRequests(res.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    getMe().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-xl border border-emerald-500/40 bg-emerald-950 px-4 py-3 text-sm font-medium text-emerald-300 shadow-lg">
          {toast}
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-900/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 md:px-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              title="Retour dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-sm font-bold text-white md:text-base">
                Demandes de modification
              </h1>
              <p className="text-[11px] text-slate-500">
                Changement de plan de session
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              title="Actualiser"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-3 py-4 md:px-4">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                filter === f.key
                  ? 'border-blue-500/50 bg-blue-500/20 text-blue-300'
                  : 'border-slate-600 bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!isOwnerOrAdmin && user && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            Vous n’avez pas la permission de valider ou refuser les demandes.
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-700/30">
                  {[
                    'Date',
                    'Fauteuil',
                    'Assistant',
                    'Ancien plan',
                    'Nouveau plan',
                    'Montants',
                    'Diff.',
                    'Raison',
                    'Statut',
                    '',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40">
                {loading && requests.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">
                      Chargement…
                    </td>
                  </tr>
                )}
                {!loading && requests.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">
                      Aucune demande pour ce filtre.
                    </td>
                  </tr>
                )}
                {requests.map((r) => {
                  const diff = amountDiff(
                    r.originalExpectedAmount,
                    r.requestedExpectedAmount,
                  );
                  return (
                    <tr key={r.id} className="hover:bg-slate-700/20">
                      <td className="px-3 py-2.5 text-xs text-slate-400 tabular-nums">
                        {new Date(r.createdAt).toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-semibold text-white">
                        {r.session.chairName}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">
                        {r.requestedBy?.name ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400">
                        {r.originalPlanName ?? 'Aucun plan'}
                        <span className="block text-[10px] text-slate-600">
                          {r.originalDurationSeconds != null
                            ? formatPlanMinutes(r.originalDurationSeconds)
                            : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-300">
                        {r.requestedPlanName}
                        <span className="block text-[10px] text-slate-600">
                          {formatPlanMinutes(r.requestedDurationSeconds)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-300 tabular-nums">
                        {r.originalExpectedAmount != null
                          ? formatDH(r.originalExpectedAmount)
                          : '—'}
                        {' → '}
                        {r.requestedExpectedAmount != null
                          ? formatDH(r.requestedExpectedAmount)
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs tabular-nums text-slate-400">
                        {formatAmountDiff(diff)}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2.5 text-xs text-slate-400" title={r.reason}>
                        {r.reason}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${planChangeStatusClass(r.status)}`}
                        >
                          {planChangeStatusLabel(r.status)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        {r.status === 'PENDING' && isOwnerOrAdmin && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setReview({ request: r, mode: 'approve' })}
                              className="flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2 py-1 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/10"
                            >
                              <Check className="h-3 w-3" />
                              Valider
                            </button>
                            <button
                              type="button"
                              onClick={() => setReview({ request: r, mode: 'reject' })}
                              className="flex items-center gap-1 rounded-lg border border-red-500/40 px-2 py-1 text-[10px] font-semibold text-red-300 hover:bg-red-500/10"
                            >
                              <X className="h-3 w-3" />
                              Refuser
                            </button>
                          </div>
                        )}
                        {r.status === 'REJECTED' && r.reviewNote && (
                          <span className="text-[10px] text-slate-500" title={r.reviewNote}>
                            Remarque
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {review && (
        <PlanChangeReviewModal
          request={review.request}
          mode={review.mode}
          onClose={() => setReview(null)}
          onSuccess={() => {
            setReview(null);
            showToast(
              review.mode === 'approve'
                ? 'Demande validée — session mise à jour.'
                : 'Demande refusée — session inchangée.',
            );
            void load();
          }}
        />
      )}
    </div>
  );
}

export default function PlanChangeRequestsPage() {
  return (
    <AuthGuard allowedRoles={['OWNER', 'ADMIN']} wrongRolePath="/assistant">
      <PlanChangeRequestsContent />
    </AuthGuard>
  );
}
