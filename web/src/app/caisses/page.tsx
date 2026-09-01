'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Wallet } from 'lucide-react';
import { AuthGuard } from '@/components/AuthGuard';
import {
  adjustCash,
  assignCashAccountStaff,
  getCashAccountDetail,
  getCashAccounts,
  getCashMovements,
  getStaffMembers,
  withdrawCash,
  getMe,
  logout,
  setInitialCashBalance,
  type AuthUser,
} from '@/lib/api';
import type {
  CashAccountDetailResponse,
  CashAccountRow,
  CashMovementItem,
  CashMovementType,
  StaffMember,
} from '@/lib/types';
import { formatCashDH, formatDateTime } from '@/lib/format';

const MOVEMENT_TYPES: { value: '' | CashMovementType; label: string }[] = [
  { value: '', label: 'Tous les types' },
  { value: 'SESSION_PAYMENT', label: 'Paiement session' },
  { value: 'MANUAL_INCOME', label: 'Entrée manuelle' },
  { value: 'INITIAL_BALANCE', label: 'Solde initial' },
  { value: 'WITHDRAWAL', label: 'Retrait' },
  { value: 'ADMIN_ADJUSTMENT', label: 'Ajustement' },
  { value: 'CORRECTION', label: 'Correction' },
  { value: 'REVERSAL', label: 'Annulation' },
  { value: 'PRIME_DEDUCTION', label: 'Prime' },
];

function signedCash(amount: number): string {
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${formatCashDH(amount)}`;
}

function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

function CashPageContent() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [businessDate, setBusinessDate] = useState('');
  const [storeTotal, setStoreTotal] = useState(0);
  const [accounts, setAccounts] = useState<CashAccountRow[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CashAccountDetailResponse | null>(null);
  const [movements, setMovements] = useState<CashMovementItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalMovements, setTotalMovements] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);

  const [filterDate, setFilterDate] = useState('');
  const [filterType, setFilterType] = useState<'' | CashMovementType>('');
  /** Staff filter — movements only; never affects physical balances */
  const [filterStaffId, setFilterStaffId] = useState('');
  /** Optional till filter for the movements panel ('' = all tills) */
  const [filterTillId, setFilterTillId] = useState('');

  const [withdrawTarget, setWithdrawTarget] = useState<CashAccountRow | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<CashAccountRow | null>(null);
  const [cutoverTarget, setCutoverTarget] = useState<CashAccountRow | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawStep, setWithdrawStep] = useState<'form' | 'confirm'>('form');
  const [desiredBalance, setDesiredBalance] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [cutoverAmount, setCutoverAmount] = useState('');
  const [cutoverReason, setCutoverReason] = useState('Cutover caisse production');
  const [cutoverStep, setCutoverStep] = useState<'form' | 'confirm'>('form');
  const [assignTarget, setAssignTarget] = useState<CashAccountRow | null>(null);
  const [assignStaffId, setAssignStaffId] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const isOwner = user?.role === 'OWNER';
  const isStaff = user?.role === 'ASSISTANT';

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.cashAccountId === selectedId) ?? null,
    [accounts, selectedId],
  );

  const canCutoverSelected =
    isOwner &&
    !!detail &&
    detail.physicalBalance === 0 &&
    totalMovements === 0 &&
    !filterDate &&
    !filterType &&
    !filterStaffId;

  const accountLabel = useCallback(
    (cashAccountId: string | undefined) => {
      if (!cashAccountId) return null;
      const a = accounts.find((x) => x.cashAccountId === cashAccountId);
      return a?.name ?? null;
    },
    [accounts],
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCashAccounts();
      setBusinessDate(res.businessDate);
      setStoreTotal(res.storeTotal);
      setAccounts(res.accounts);

      if (user?.role === 'OWNER' || user?.role === 'ADMIN') {
        const staffRes = await getStaffMembers('active').catch(() => ({
          items: [] as StaffMember[],
        }));
        setStaffList(staffRes.items);
      } else {
        setStaffList([]);
      }

      // Staff: auto-select their only till
      if (user?.role === 'ASSISTANT' && res.accounts.length === 1) {
        setSelectedId(res.accounts[0]!.cashAccountId);
        setFilterTillId(res.accounts[0]!.cashAccountId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  const loadMovements = useCallback(
    async (
      pageNum = 1,
      overrides?: {
        cashAccountId?: string | null;
        date?: string;
        type?: '' | CashMovementType;
        staffMemberId?: string;
        tillId?: string;
      },
    ) => {
      setDetailLoading(true);
      try {
        const date = overrides?.date ?? filterDate;
        const type = overrides?.type ?? filterType;
        const staffMemberId =
          overrides?.staffMemberId !== undefined ? overrides.staffMemberId : filterStaffId;
        const tillOverride = overrides?.tillId !== undefined ? overrides.tillId : filterTillId;
        const focusId =
          overrides?.cashAccountId !== undefined ? overrides.cashAccountId : selectedId;

        // Till for movements: explicit till filter, else selected card, else all
        const cashAccountId = tillOverride || focusId || undefined;

        const m = await getCashMovements({
          cashAccountId: cashAccountId || undefined,
          page: pageNum,
          pageSize: 25,
          date: date || undefined,
          type: type || undefined,
          staffMemberId: staffMemberId || undefined,
        });
        setMovements(m.items);
        setPage(m.page);
        setTotalPages(m.totalPages);
        setTotalMovements(m.total);

        if (focusId) {
          const d = await getCashAccountDetail(focusId);
          setDetail(d);
        } else {
          setDetail(null);
        }
      } catch (err) {
        setToast(err instanceof Error ? err.message : 'Erreur détail');
      } finally {
        setDetailLoading(false);
      }
    },
    [filterDate, filterType, filterStaffId, filterTillId, selectedId],
  );

  useEffect(() => {
    getMe()
      .then((u) => setUser(u))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadList().then(() => {
      void loadMovements(1, {
        cashAccountId: null,
        tillId: '',
        date: '',
        type: '',
        staffMemberId: '',
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, loadList]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  function openDetail(cashAccountId: string) {
    setSelectedId(cashAccountId);
    setFilterTillId(cashAccountId);
    setPage(1);
    setFilterDate('');
    setFilterType('');
    // Keep staff filter — it only affects movements
    void loadMovements(1, {
      cashAccountId,
      tillId: cashAccountId,
      date: '',
      type: '',
    });
  }

  async function refreshAll() {
    await loadList();
    await loadMovements(page);
  }

  function openWithdraw(row: CashAccountRow) {
    setWithdrawTarget(row);
    setWithdrawAmount('');
    setWithdrawReason('');
    setWithdrawStep('form');
    setActionError(null);
  }

  function openAdjust(row: CashAccountRow) {
    setAdjustTarget(row);
    setDesiredBalance(String(row.physicalBalance));
    setAdjustReason('');
    setActionError(null);
  }

  function openCutover(row: CashAccountRow) {
    setCutoverTarget(row);
    setCutoverAmount('');
    setCutoverReason('Cutover caisse production');
    setCutoverStep('form');
    setActionError(null);
  }

  function openAssign(row: CashAccountRow) {
    setAssignTarget(row);
    setAssignStaffId(row.staffMemberId ?? '');
    setActionError(null);
  }

  /** Staff not assigned to another till (except current row's assignee). */
  const assignableStaff = useMemo(() => {
    const taken = new Set(
      accounts
        .filter((a) => a.staffMemberId && a.cashAccountId !== assignTarget?.cashAccountId)
        .map((a) => a.staffMemberId as string),
    );
    return staffList.filter((s) => s.isActive && !taken.has(s.id));
  }, [accounts, assignTarget, staffList]);

  async function submitAssign() {
    if (!assignTarget || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await assignCashAccountStaff(assignTarget.cashAccountId, {
        staffMemberId: assignStaffId.trim() ? assignStaffId.trim() : null,
      });
      setAssignTarget(null);
      setToast('Affectation enregistrée');
      await loadList();
      if (selectedId === assignTarget.cashAccountId) {
        await loadMovements(page);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Échec affectation');
    } finally {
      setActionBusy(false);
    }
  }

  const withdrawPreview = useMemo(() => {
    if (!withdrawTarget) return null;
    const amount = parseAmount(withdrawAmount);
    if (amount == null || !(amount > 0)) return null;
    const before = withdrawTarget.physicalBalance;
    return {
      before,
      amount,
      after: Math.round((before - amount) * 100) / 100,
      insufficient: amount > before,
    };
  }, [withdrawTarget, withdrawAmount]);

  const adjustPreview = useMemo(() => {
    if (!adjustTarget) return null;
    const desired = parseAmount(desiredBalance);
    if (desired == null) return null;
    const before = adjustTarget.physicalBalance;
    const diff = Math.round((desired - before) * 100) / 100;
    return { before, desired, diff, unchanged: diff === 0 };
  }, [adjustTarget, desiredBalance]);

  const cutoverPreview = useMemo(() => {
    if (!cutoverTarget) return null;
    const amount = parseAmount(cutoverAmount);
    if (amount == null || amount < 0) return null;
    return { amount, after: amount };
  }, [cutoverTarget, cutoverAmount]);

  async function submitWithdraw() {
    if (!withdrawTarget || !withdrawPreview || withdrawPreview.insufficient || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await withdrawCash(withdrawTarget.cashAccountId, {
        amount: withdrawPreview.amount,
        reason: withdrawReason.trim() || undefined,
      });
      setWithdrawTarget(null);
      setToast('Retrait enregistré');
      setSelectedId(withdrawTarget.cashAccountId);
      setFilterTillId(withdrawTarget.cashAccountId);
      await loadList();
      await loadMovements(1, {
        cashAccountId: withdrawTarget.cashAccountId,
        tillId: withdrawTarget.cashAccountId,
      });
      setPage(1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Échec du retrait');
    } finally {
      setActionBusy(false);
    }
  }

  async function submitAdjust() {
    if (!adjustTarget || !adjustPreview || adjustPreview.unchanged || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await adjustCash(adjustTarget.cashAccountId, {
        desiredBalance: adjustPreview.desired,
        reason: adjustReason.trim() || undefined,
      });
      setAdjustTarget(null);
      setToast('Correction enregistrée dans l’historique');
      setSelectedId(adjustTarget.cashAccountId);
      setFilterTillId(adjustTarget.cashAccountId);
      await loadList();
      await loadMovements(1, {
        cashAccountId: adjustTarget.cashAccountId,
        tillId: adjustTarget.cashAccountId,
      });
      setPage(1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Échec de la correction');
    } finally {
      setActionBusy(false);
    }
  }

  async function submitCutover() {
    if (!cutoverTarget || !cutoverPreview || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await setInitialCashBalance(cutoverTarget.cashAccountId, {
        countedAmount: cutoverPreview.amount,
        reason: cutoverReason.trim() || 'Cutover caisse production',
      });
      setCutoverTarget(null);
      setToast('Solde d’ouverture enregistré');
      setSelectedId(cutoverTarget.cashAccountId);
      setFilterTillId(cutoverTarget.cashAccountId);
      await loadList();
      await loadMovements(1, {
        cashAccountId: cutoverTarget.cashAccountId,
        tillId: cutoverTarget.cashAccountId,
      });
      setPage(1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Échec du cutover');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href={isStaff ? '/assistant' : '/'}
              className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
              title="Retour"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-stone-700" />
              <div>
                <h1 className="text-base font-semibold text-stone-900">
                  {isStaff ? 'Ma caisse — Solde net' : 'Caisses'}
                </h1>
                {businessDate && (
                  <p className="text-xs text-stone-500">
                    {isStaff ? `Journée ${businessDate}` : `Administration · Journée ${businessDate}`}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <span className="hidden text-xs text-stone-500 sm:inline">{user.name}</span>
            )}
            <button
              type="button"
              onClick={() => void refreshAll()}
              className="rounded-lg p-2 text-stone-500 hover:bg-stone-100"
              title="Actualiser"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg px-2 py-1 text-xs text-stone-500 hover:bg-stone-100"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {toast && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {toast}
          </div>
        )}

        {/* Store total — OWNER/ADMIN only */}
        {isAdmin && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800/70">
              Total magasin
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums text-amber-950">
              {loading ? '…' : formatCashDH(storeTotal)}
            </p>
            <p className="mt-0.5 text-xs text-amber-800/60">Caisse 1 + Caisse 2 (soldes nets)</p>
          </div>
        )}

        {!loading && isAdmin && accounts.length > 0 && (
          <div className="mb-4 overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-stone-100 bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Caisse</th>
                  <th className="px-4 py-2 font-semibold">Fille affectée</th>
                  <th className="px-4 py-2 font-semibold text-right">Sessions</th>
                  <th className="px-4 py-2 font-semibold text-right">Primes</th>
                  <th className="px-4 py-2 font-semibold text-right">Retraits</th>
                  <th className="px-4 py-2 font-semibold text-right">Ajust.</th>
                  <th className="px-4 py-2 font-semibold text-right">Solde net</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.cashAccountId} className="border-b border-stone-50 last:border-0">
                    <td className="px-4 py-2 font-medium text-stone-900">{a.name}</td>
                    <td className="px-4 py-2">
                      {a.staffMemberName ? (
                        <span className="text-stone-800">{a.staffMemberName}</span>
                      ) : (
                        <span className="text-amber-700">⚠ Aucune fille affectée</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {(a.sessionIncome ?? a.incomes)
                        ? signedCash(a.sessionIncome ?? a.incomes)
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-violet-700">
                      {a.primeDeductions
                        ? signedCash(a.primeDeductions)
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-700">
                      {a.withdrawals ? `−${formatCashDH(a.withdrawals)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {a.adjustments ? signedCash(a.adjustments) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">
                      {formatCashDH(a.physicalBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Physical till cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          {loading && accounts.length === 0 && (
            <>
              <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-400">
                Chargement…
              </div>
              <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-400">
                Chargement…
              </div>
            </>
          )}
          {!loading && accounts.length === 0 && (
            <div className="col-span-full rounded-xl border border-stone-200 bg-white px-4 py-10 text-center text-stone-400">
              {isStaff
                ? 'Aucune caisse ne vous est actuellement affectée.'
                : 'Aucune caisse physique'}
            </div>
          )}
          {accounts.map((a) => {
            const selected = selectedId === a.cashAccountId;
            return (
              <div
                key={a.cashAccountId}
                className={`rounded-xl border bg-white p-4 md:p-5 transition ${
                  selected
                    ? 'border-amber-300 ring-1 ring-amber-200'
                    : 'border-stone-200 hover:border-stone-300'
                } ${isStaff ? 'sm:col-span-2 max-w-lg' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-stone-900">{a.name}</h2>
                    <p className="text-[11px] uppercase tracking-wide text-stone-400">{a.code}</p>
                    <p className="mt-1 text-sm text-stone-600">
                      {a.staffMemberName ? (
                        <>Fille : <span className="font-medium text-stone-900">{a.staffMemberName}</span></>
                      ) : (
                        <span className="font-medium text-amber-700">⚠ Aucune fille affectée</span>
                      )}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      a.isActive
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-stone-100 text-stone-500 ring-1 ring-stone-200'
                    }`}
                  >
                    {a.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-stone-400">
                  {isStaff ? 'Solde net' : 'Solde net caisse'}
                </p>
                <p className="text-2xl font-semibold tabular-nums text-stone-900">
                  {formatCashDH(a.physicalBalance)}
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat
                    label="Sessions"
                    value={
                      (a.sessionIncome ?? a.incomes)
                        ? signedCash(a.sessionIncome ?? a.incomes)
                        : '—'
                    }
                    tone="pos"
                  />
                  <Stat
                    label="Primes"
                    value={a.primeDeductions ? signedCash(a.primeDeductions) : '—'}
                    tone="neg"
                  />
                  <Stat
                    label="Retraits"
                    value={a.withdrawals ? `−${formatCashDH(a.withdrawals)}` : '—'}
                    tone="neg"
                  />
                  <Stat
                    label="Ajust."
                    value={a.adjustments ? signedCash(a.adjustments) : '—'}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openDetail(a.cashAccountId)}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100"
                  >
                    Mouvements
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => openAssign(a)}
                        className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50"
                      >
                        Affecter une fille
                      </button>
                      <button
                        type="button"
                        onClick={() => openWithdraw(a)}
                        className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50"
                      >
                        Retirer
                      </button>
                      <button
                        type="button"
                        onClick={() => openAdjust(a)}
                        className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50"
                      >
                        Corriger
                      </button>
                      {isOwner && a.physicalBalance === 0 && (
                        <button
                          type="button"
                          onClick={() => openCutover(a)}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100"
                        >
                          Solde d&apos;ouverture
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Movements panel */}
        <section className="mt-6 rounded-xl border border-stone-200 bg-white p-4 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">
                {detail ? detail.name : 'Mouvements'}
              </h2>
              {detail ? (
                <p className="mt-1 text-sm text-stone-600">
                  Solde net :{' '}
                  <span className="font-semibold text-stone-900">
                    {formatCashDH(detail.physicalBalance)}
                  </span>
                  <span className="ml-2 text-xs text-stone-400">
                    (revenu sessions − primes − retraits ± ajustements)
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-sm text-stone-500">
                  Toutes les caisses — sélectionnez une caisse ou filtrez ci-dessous.
                </p>
              )}
            </div>
            {isAdmin && selectedAccount && (
              <div className="flex flex-wrap gap-2">
                {canCutoverSelected && (
                  <button
                    type="button"
                    onClick={() => openCutover(selectedAccount)}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 hover:bg-amber-100"
                  >
                    Solde d&apos;ouverture
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openWithdraw(selectedAccount)}
                  className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white hover:bg-stone-800"
                >
                  Retirer
                </button>
                <button
                  type="button"
                  onClick={() => openAdjust(selectedAccount)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-800 hover:bg-stone-50"
                >
                  Corriger le solde
                </button>
              </div>
            )}
          </div>

          {detail && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Aujourd&apos;hui ({detail.businessDate})
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Opening" value={formatCashDH(detail.today.openingBalance)} />
                <Stat
                  label="Sessions"
                  value={signedCash(detail.today.sessionIncome ?? detail.today.incomes)}
                  tone="pos"
                />
                <Stat
                  label="Primes"
                  value={
                    detail.today.primeDeductions
                      ? signedCash(detail.today.primeDeductions)
                      : '—'
                  }
                  tone="neg"
                />
                <Stat
                  label="Retraits"
                  value={`−${formatCashDH(detail.today.withdrawals)}`}
                  tone="neg"
                />
                <Stat label="Ajustements" value={signedCash(detail.today.adjustments)} />
                <Stat
                  label="Solde net"
                  value={formatCashDH(detail.today.currentBalance)}
                  strong
                />
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-end gap-3">
            {isAdmin && (
              <>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500">Caisse</label>
                  <select
                    value={filterTillId}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFilterTillId(v);
                      setSelectedId(v || null);
                    }}
                    className="mt-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  >
                    <option value="">Toutes</option>
                    {accounts.map((a) => (
                      <option key={a.cashAccountId} value={a.cashAccountId}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500">Fille</label>
                  <select
                    value={filterStaffId}
                    onChange={(e) => setFilterStaffId(e.target.value)}
                    className="mt-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  >
                    <option value="">Toutes</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div>
              <label className="block text-[11px] font-medium text-stone-500">Date</label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="mt-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-stone-500">Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as '' | CashMovementType)}
                className="mt-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
              >
                {MOVEMENT_TYPES.map((t) => (
                  <option key={t.value || 'all'} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                setPage(1);
                void loadMovements(1);
              }}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-800 hover:bg-stone-50"
            >
              Filtrer
            </button>
            {(filterDate || filterType || filterStaffId || filterTillId || selectedId) && (
              <button
                type="button"
                onClick={() => {
                  setFilterDate('');
                  setFilterType('');
                  setFilterStaffId('');
                  setFilterTillId('');
                  setSelectedId(null);
                  setDetail(null);
                  setPage(1);
                  void loadMovements(1, {
                    cashAccountId: null,
                    tillId: '',
                    date: '',
                    type: '',
                    staffMemberId: '',
                  });
                }}
                className="rounded-lg px-3 py-2 text-xs text-stone-500 hover:text-stone-800"
              >
                Réinitialiser
              </button>
            )}
          </div>

          <h3 className="mt-5 text-sm font-semibold text-stone-800">
            Historique
            <span className="ml-2 text-xs font-normal text-stone-400">
              ({totalMovements} mouvement{totalMovements === 1 ? '' : 's'})
            </span>
          </h3>

          {detailLoading ? (
            <p className="mt-3 text-sm text-stone-400">Chargement…</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-xs sm:text-sm">
                <thead className="border-b border-stone-200 text-[10px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Date/heure</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="hidden py-2 pr-3 font-medium sm:table-cell">Fille</th>
                    {!filterTillId && (
                      <th className="hidden py-2 pr-3 font-medium md:table-cell">Caisse</th>
                    )}
                    <th className="py-2 pr-3 text-right font-medium">Montant</th>
                    <th className="hidden py-2 pr-3 text-right font-medium md:table-cell">Avant</th>
                    <th className="hidden py-2 pr-3 text-right font-medium md:table-cell">Après</th>
                    <th className="hidden py-2 pr-3 font-medium lg:table-cell">Raison</th>
                    <th className="py-2 font-medium">Par</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-stone-400">
                        Aucun mouvement
                        {!selectedId && !filterTillId && !filterStaffId
                          ? ' — cliquez « Mouvements » sur une caisse ou filtrez'
                          : ''}
                      </td>
                    </tr>
                  )}
                  {movements.map((m) => (
                    <tr key={m.id} className="border-t border-stone-100">
                      <td className="py-2.5 pr-3 whitespace-nowrap text-stone-600">
                        {formatDateTime(m.createdAt)}
                      </td>
                      <td className="py-2.5 pr-3 text-stone-800">{m.label}</td>
                      <td className="hidden py-2.5 pr-3 text-stone-600 sm:table-cell">
                        {m.staffMemberName || '—'}
                      </td>
                      {!filterTillId && (
                        <td className="hidden py-2.5 pr-3 text-stone-500 md:table-cell">
                          {accountLabel(m.cashAccountId) || '—'}
                        </td>
                      )}
                      <td
                        className={`py-2.5 pr-3 text-right tabular-nums font-semibold ${
                          m.amount >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {signedCash(m.amount)}
                      </td>
                      <td className="hidden py-2.5 pr-3 text-right tabular-nums text-stone-500 md:table-cell">
                        {formatCashDH(m.balanceBefore)}
                      </td>
                      <td className="hidden py-2.5 pr-3 text-right tabular-nums text-stone-700 md:table-cell">
                        {formatCashDH(m.balanceAfter)}
                      </td>
                      <td className="hidden max-w-[10rem] truncate py-2.5 pr-3 text-stone-500 lg:table-cell">
                        {m.reason || '—'}
                      </td>
                      <td className="py-2.5 text-stone-500">{m.createdByName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                disabled={page <= 1 || detailLoading}
                onClick={() => {
                  const next = page - 1;
                  setPage(next);
                  void loadMovements(next);
                }}
                className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Précédent
              </button>
              <span className="text-xs text-stone-500">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || detailLoading}
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  void loadMovements(next);
                }}
                className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Suivant
              </button>
            </div>
          )}
        </section>
      </main>

      {assignTarget && (
        <Modal
          title={`Affecter — ${assignTarget.name}`}
          onClose={() => !actionBusy && setAssignTarget(null)}
        >
          <p className="mb-3 text-xs text-stone-500">
            Choisissez la fille responsable de cette caisse physique. Les mouvements passés
            conservent leur attribution historique.
          </p>
          <label className="block text-xs font-medium text-stone-600">Fille</label>
          <select
            value={assignStaffId}
            onChange={(e) => setAssignStaffId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">— Aucune (désaffecter) —</option>
            {assignTarget.staffMemberId &&
              !assignableStaff.some((s) => s.id === assignTarget.staffMemberId) && (
                <option value={assignTarget.staffMemberId}>
                  {assignTarget.staffMemberName} (actuelle)
                </option>
              )}
            {assignableStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAssignTarget(null)}
              className="rounded-lg px-3 py-2 text-xs text-stone-600"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void submitAssign()}
              className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {actionBusy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </Modal>
      )}

      {withdrawTarget && (
        <Modal
          title={`Retirer — ${withdrawTarget.name}`}
          onClose={() => !actionBusy && setWithdrawTarget(null)}
        >
          {withdrawStep === 'form' ? (
            <>
              <p className="mb-3 text-xs text-stone-500">
                Solde physique : <strong>{formatCashDH(withdrawTarget.physicalBalance)}</strong>
              </p>
              <label className="block text-xs font-medium text-stone-600">Montant (DH)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                autoFocus
              />
              <label className="mt-3 block text-xs font-medium text-stone-600">
                Raison
              </label>
              <input
                type="text"
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                placeholder="Ex. écart inventaire physique (optionnel)"
              />
              {withdrawPreview && (
                <div className="mt-3 space-y-1 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-700">
                  <p>Solde avant : {formatCashDH(withdrawPreview.before)}</p>
                  <p>Montant retiré : −{formatCashDH(withdrawPreview.amount)}</p>
                  <p className="font-semibold">
                    Solde après : {formatCashDH(withdrawPreview.after)}
                  </p>
                  {withdrawPreview.insufficient && (
                    <p className="text-red-600">Solde insuffisant.</p>
                  )}
                </div>
              )}
              {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setWithdrawTarget(null)}
                  className="rounded-lg px-3 py-2 text-xs text-stone-600"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={!withdrawPreview || withdrawPreview.insufficient}
                  onClick={() => {
                    setActionError(null);
                    setWithdrawStep('confirm');
                  }}
                  className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                >
                  Continuer
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-stone-700">
                Confirmer le retrait de{' '}
                <strong>{formatCashDH(withdrawPreview?.amount ?? 0)}</strong> de{' '}
                <strong>{withdrawTarget.name}</strong> ?
              </p>
              <p className="mt-2 text-xs text-stone-500">
                Nouveau solde prévu : {formatCashDH(withdrawPreview?.after ?? 0)}
              </p>
              {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setWithdrawStep('form')}
                  className="rounded-lg px-3 py-2 text-xs text-stone-600"
                >
                  Retour
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void submitWithdraw()}
                  className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {actionBusy ? 'Enregistrement…' : 'Confirmer le retrait'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {adjustTarget && (
        <Modal
          title={`Corriger — ${adjustTarget.name}`}
          onClose={() => !actionBusy && setAdjustTarget(null)}
        >
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Une correction crée un mouvement <strong>ADMIN_ADJUSTMENT</strong> dans
            l&apos;historique. Le solde n&apos;est jamais écrasé silencieusement.
          </div>
          <p className="mb-3 text-xs text-stone-500">
            Solde actuel : <strong>{formatCashDH(adjustTarget.physicalBalance)}</strong>
          </p>
          <label className="block text-xs font-medium text-stone-600">
            Nouveau solde réel (DH)
          </label>
          <input
            type="number"
            step="0.01"
            value={desiredBalance}
            onChange={(e) => setDesiredBalance(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            autoFocus
          />
          {adjustPreview && (
            <p className="mt-2 text-sm text-stone-700">
              Différence :{' '}
              <strong className={adjustPreview.diff >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                {signedCash(adjustPreview.diff)}
              </strong>
            </p>
          )}
          <label className="mt-3 block text-xs font-medium text-stone-600">Raison</label>
          <input
            type="text"
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            placeholder="Ex. écart inventaire physique (optionnel)"
          />
          {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdjustTarget(null)}
              className="rounded-lg px-3 py-2 text-xs text-stone-600"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={!adjustPreview || adjustPreview.unchanged || actionBusy}
              onClick={() => void submitAdjust()}
              className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              {actionBusy ? 'Enregistrement…' : 'Confirmer la correction'}
            </button>
          </div>
        </Modal>
      )}

      {cutoverTarget && (
        <Modal
          title={`Solde d'ouverture — ${cutoverTarget.name}`}
          onClose={() => !actionBusy && setCutoverTarget(null)}
        >
          {cutoverStep === 'form' ? (
            <>
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                Cutover production uniquement (OWNER). Comptez le cash physique de cette caisse —
                aucun backfill des anciennes sessions.
              </div>
              <label className="block text-xs font-medium text-stone-600">
                Montant compté (DH)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={cutoverAmount}
                onChange={(e) => setCutoverAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                autoFocus
              />
              <label className="mt-3 block text-xs font-medium text-stone-600">Motif</label>
              <input
                type="text"
                value={cutoverReason}
                onChange={(e) => setCutoverReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
              {cutoverPreview && (
                <div className="mt-3 space-y-1 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-700">
                  <p>Solde avant : {formatCashDH(0)}</p>
                  <p className="font-semibold">
                    Solde après : {formatCashDH(cutoverPreview.after)}
                  </p>
                </div>
              )}
              {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCutoverTarget(null)}
                  className="rounded-lg px-3 py-2 text-xs text-stone-600"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={!cutoverPreview}
                  onClick={() => {
                    setActionError(null);
                    setCutoverStep('confirm');
                  }}
                  className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                >
                  Continuer
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-stone-700">
                Enregistrer un <strong>INITIAL_BALANCE</strong> de{' '}
                <strong>{formatCashDH(cutoverPreview?.amount ?? 0)}</strong> pour{' '}
                <strong>{cutoverTarget.name}</strong> ?
              </p>
              <p className="mt-2 text-xs text-stone-500">
                Opération unique et irréversible (un seul solde d&apos;ouverture par caisse
                physique).
              </p>
              {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setCutoverStep('form')}
                  className="rounded-lg px-3 py-2 text-xs text-stone-600"
                >
                  Retour
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void submitCutover()}
                  className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {actionBusy ? 'Enregistrement…' : 'Confirmer le cutover'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg';
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p
        className={`mt-0.5 tabular-nums text-sm ${
          strong
            ? 'font-semibold text-stone-900'
            : tone === 'pos'
              ? 'text-emerald-700'
              : tone === 'neg'
                ? 'text-red-700'
                : 'text-stone-700'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-700">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function CaissesPage() {
  return (
    <AuthGuard allowedRoles={['OWNER', 'ADMIN', 'ASSISTANT']}>
      <CashPageContent />
    </AuthGuard>
  );
}
