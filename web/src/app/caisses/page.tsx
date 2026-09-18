'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Minus,
  Plus,
  RefreshCw,
  UserRound,
  Wallet,
} from 'lucide-react';
import { AuthGuard } from '@/components/AuthGuard';
import {
  assignCashAccountStaff,
  creditCash,
  getCashAccounts,
  getCashMovements,
  getStaffMembers,
  withdrawCash,
  getMe,
  logout,
  type AuthUser,
} from '@/lib/api';
import type {
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

const PAGE_SIZE = 20;
const MAX_RANGE_DAYS = 31;

function signedCash(amount: number): string {
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${formatCashDH(amount)}`;
}

function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

function enumerateDays(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  if (from > to) return [];
  const days: string[] = [];
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cursor <= end && days.length < MAX_RANGE_DAYS) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
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

  const [showHistory, setShowHistory] = useState(false);
  const [movements, setMovements] = useState<CashMovementItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalMovements, setTotalMovements] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterType, setFilterType] = useState<'' | CashMovementType>('');
  const [filterStaffId, setFilterStaffId] = useState('');
  const [filterTillId, setFilterTillId] = useState('');

  const [creditOpen, setCreditOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const [actionAccountId, setActionAccountId] = useState('');
  const [actionAmount, setActionAmount] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actionStep, setActionStep] = useState<'form' | 'confirm'>('form');
  const [assignStaffId, setAssignStaffId] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const todayEntries = useMemo(
    () =>
      accounts.reduce((sum, a) => sum + (a.sessionIncome ?? a.incomes ?? 0), 0),
    [accounts],
  );
  const todayWithdrawals = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.withdrawals ?? 0), 0),
    [accounts],
  );
  const todayPrimes = useMemo(
    () => accounts.reduce((sum, a) => sum + Math.abs(a.primeDeductions ?? 0), 0),
    [accounts],
  );

  const actionAccount = useMemo(
    () => accounts.find((a) => a.cashAccountId === actionAccountId) ?? null,
    [accounts, actionAccountId],
  );

  const assignableStaff = useMemo(() => {
    const taken = new Set(
      accounts
        .filter((a) => a.staffMemberId && a.cashAccountId !== actionAccountId)
        .map((a) => a.staffMemberId as string),
    );
    return staffList.filter((s) => s.isActive && !taken.has(s.id));
  }, [accounts, actionAccountId, staffList]);

  const creditPreview = useMemo(() => {
    if (!actionAccount || !creditOpen) return null;
    const amount = parseAmount(actionAmount);
    if (amount == null || !(amount > 0)) return null;
    const before = actionAccount.physicalBalance;
    return {
      before,
      amount,
      after: Math.round((before + amount) * 100) / 100,
    };
  }, [actionAccount, actionAmount, creditOpen]);

  const withdrawPreview = useMemo(() => {
    if (!actionAccount || !withdrawOpen) return null;
    const amount = parseAmount(actionAmount);
    if (amount == null || !(amount > 0)) return null;
    const before = actionAccount.physicalBalance;
    return {
      before,
      amount,
      after: Math.round((before - amount) * 100) / 100,
      insufficient: amount > before,
    };
  }, [actionAccount, actionAmount, withdrawOpen]);

  const accountLabel = useCallback(
    (cashAccountId: string | undefined) => {
      if (!cashAccountId) return null;
      return accounts.find((x) => x.cashAccountId === cashAccountId)?.name ?? null;
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
      const staffRes = await getStaffMembers('active').catch(() => ({
        items: [] as StaffMember[],
      }));
      setStaffList(staffRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMovements = useCallback(
    async (
      pageNum = 1,
      overrides?: {
        dateFrom?: string;
        dateTo?: string;
        type?: '' | CashMovementType;
        staffMemberId?: string;
        tillId?: string;
      },
    ) => {
      setHistoryLoading(true);
      try {
        const dateFrom = overrides?.dateFrom ?? filterDateFrom;
        const dateTo = overrides?.dateTo ?? filterDateTo;
        const type = overrides?.type ?? filterType;
        const staffMemberId =
          overrides?.staffMemberId !== undefined ? overrides.staffMemberId : filterStaffId;
        const tillId = overrides?.tillId !== undefined ? overrides.tillId : filterTillId;

        const from = dateFrom || dateTo;
        const to = dateTo || dateFrom;
        const days = from && to ? enumerateDays(from, to) : [];

        const baseParams = {
          cashAccountId: tillId || undefined,
          pageSize: 50 as const,
          type: type || undefined,
          staffMemberId: staffMemberId || undefined,
        };

        if (days.length <= 1) {
          const m = await getCashMovements({
            ...baseParams,
            page: pageNum,
            pageSize: PAGE_SIZE,
            date: days[0] || undefined,
          });
          setMovements(m.items);
          setPage(m.page);
          setTotalPages(m.totalPages);
          setTotalMovements(m.total);
        } else {
          const batches = await Promise.all(
            days.map((date) =>
              getCashMovements({
                ...baseParams,
                page: 1,
                pageSize: 50,
                date,
              }),
            ),
          );
          const merged = batches
            .flatMap((b) => b.items)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          const total = merged.length;
          const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
          const start = (pageNum - 1) * PAGE_SIZE;
          setMovements(merged.slice(start, start + PAGE_SIZE));
          setPage(pageNum);
          setTotalPages(pages);
          setTotalMovements(total);
        }
      } catch (err) {
        setToast(err instanceof Error ? err.message : 'Erreur historique');
      } finally {
        setHistoryLoading(false);
      }
    },
    [filterDateFrom, filterDateTo, filterType, filterStaffId, filterTillId],
  );

  useEffect(() => {
    getMe()
      .then((u) => setUser(u))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadList();
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

  async function refreshAll() {
    await loadList();
    if (showHistory) await loadMovements(page);
  }

  function resetActionForm(defaultAccountId?: string) {
    setActionAccountId(defaultAccountId ?? accounts[0]?.cashAccountId ?? '');
    setActionAmount('');
    setActionReason('');
    setActionStep('form');
    setActionError(null);
  }

  function openCredit() {
    resetActionForm();
    setCreditOpen(true);
    setWithdrawOpen(false);
    setAssignOpen(false);
  }

  function openWithdraw() {
    resetActionForm();
    setWithdrawOpen(true);
    setCreditOpen(false);
    setAssignOpen(false);
  }

  function openAssign() {
    resetActionForm();
    const defaultId = accounts[0]?.cashAccountId ?? '';
    const row = accounts.find((a) => a.cashAccountId === defaultId);
    setAssignStaffId(row?.staffMemberId ?? '');
    setAssignOpen(true);
    setCreditOpen(false);
    setWithdrawOpen(false);
  }

  function closeModals() {
    if (actionBusy) return;
    setCreditOpen(false);
    setWithdrawOpen(false);
    setAssignOpen(false);
    setActionError(null);
  }

  async function submitCredit() {
    if (!actionAccount || !creditPreview || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await creditCash(actionAccount.cashAccountId, {
        amount: creditPreview.amount,
        reason: actionReason.trim() || undefined,
      });
      setCreditOpen(false);
      setToast('Entrée enregistrée');
      await loadList();
      if (showHistory) await loadMovements(1);
      setPage(1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Échec de l’ajout');
    } finally {
      setActionBusy(false);
    }
  }

  async function submitWithdraw() {
    if (!actionAccount || !withdrawPreview || withdrawPreview.insufficient || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await withdrawCash(actionAccount.cashAccountId, {
        amount: withdrawPreview.amount,
        reason: actionReason.trim() || undefined,
      });
      setWithdrawOpen(false);
      setToast('Retrait enregistré');
      await loadList();
      if (showHistory) await loadMovements(1);
      setPage(1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Échec du retrait');
    } finally {
      setActionBusy(false);
    }
  }

  async function submitAssign() {
    if (!actionAccount || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await assignCashAccountStaff(actionAccount.cashAccountId, {
        staffMemberId: assignStaffId.trim() ? assignStaffId.trim() : null,
      });
      setAssignOpen(false);
      setToast('Affectation enregistrée');
      await loadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Échec affectation');
    } finally {
      setActionBusy(false);
    }
  }

  async function openHistory() {
    setShowHistory(true);
    setPage(1);
    await loadMovements(1);
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
              title="Retour"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-stone-700" />
              <div>
                <h1 className="text-base font-semibold text-stone-900">Caisses</h1>
                {businessDate && (
                  <p className="text-xs text-stone-500">Journée {businessDate}</p>
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

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5 pb-10">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {toast && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {toast}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            label="Solde actuel"
            value={loading ? '…' : formatCashDH(storeTotal)}
            emphasis
          />
          <SummaryCard
            label="Entrées du jour"
            value={loading ? '…' : signedCash(todayEntries)}
            tone="pos"
          />
          <SummaryCard
            label="Retraits du jour"
            value={loading ? '…' : todayWithdrawals ? `−${formatCashDH(todayWithdrawals)}` : '0 DH'}
            tone="neg"
          />
          <SummaryCard
            label="Primes"
            value={loading ? '…' : todayPrimes ? `−${formatCashDH(todayPrimes)}` : '0 DH'}
            compact
          />
        </div>

        {/* Till snapshot */}
        {!loading && accounts.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {accounts.map((a) => (
              <div
                key={a.cashAccountId}
                className="rounded-xl border border-stone-200 bg-white px-4 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-900">{a.name}</p>
                  <p className="text-sm font-semibold tabular-nums text-stone-900">
                    {formatCashDH(a.physicalBalance)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {a.staffMemberName ? (
                    <>Affectée : <span className="font-medium text-stone-700">{a.staffMemberName}</span></>
                  ) : (
                    <span className="text-amber-700">Aucune fille affectée</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Main actions */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={openCredit}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            <Plus className="h-4 w-4" />
            Ajouter
          </button>
          <button
            type="button"
            onClick={openWithdraw}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white hover:bg-stone-800"
          >
            <Minus className="h-4 w-4" />
            Retirer
          </button>
        </div>

        <button
          type="button"
          onClick={openAssign}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-800 hover:bg-stone-50"
        >
          <UserRound className="h-4 w-4" />
          Affecter une caisse
        </button>

        {/* History (collapsed by default) */}
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Historique</h2>
              <p className="text-xs text-stone-500">Filtrer puis afficher les mouvements</p>
            </div>
            {!showHistory ? (
              <button
                type="button"
                onClick={() => void openHistory()}
                className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-800 hover:bg-stone-100"
              >
                Afficher
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="rounded-lg px-3 py-2 text-xs text-stone-500 hover:text-stone-800"
              >
                Masquer
              </button>
            )}
          </div>

          {showHistory && (
            <>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-medium text-stone-500">Du</label>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500">Au</label>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500">Type</label>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as '' | CashMovementType)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  >
                    {MOVEMENT_TYPES.map((t) => (
                      <option key={t.value || 'all'} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500">Caisse</label>
                  <select
                    value={filterTillId}
                    onChange={(e) => setFilterTillId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  >
                    <option value="">Toutes</option>
                    {accounts.map((a) => (
                      <option key={a.cashAccountId} value={a.cashAccountId}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-stone-500">Employée</label>
                  <select
                    value={filterStaffId}
                    onChange={(e) => setFilterStaffId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  >
                    <option value="">Toutes</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPage(1);
                    void loadMovements(1);
                  }}
                  className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white hover:bg-stone-800"
                >
                  Filtrer
                </button>
                {(filterDateFrom || filterDateTo || filterType || filterStaffId || filterTillId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterDateFrom('');
                      setFilterDateTo('');
                      setFilterType('');
                      setFilterStaffId('');
                      setFilterTillId('');
                      setPage(1);
                      void loadMovements(1, {
                        dateFrom: '',
                        dateTo: '',
                        type: '',
                        staffMemberId: '',
                        tillId: '',
                      });
                    }}
                    className="rounded-lg px-3 py-2 text-xs text-stone-500 hover:text-stone-800"
                  >
                    Réinitialiser
                  </button>
                )}
              </div>

              <p className="mt-4 text-xs text-stone-400">
                {totalMovements} mouvement{totalMovements === 1 ? '' : 's'}
              </p>

              {historyLoading ? (
                <p className="mt-3 text-sm text-stone-400">Chargement…</p>
              ) : (
                <ul className="mt-3 divide-y divide-stone-100">
                  {movements.length === 0 && (
                    <li className="py-6 text-center text-sm text-stone-400">Aucun mouvement</li>
                  )}
                  {movements.map((m) => (
                    <li key={m.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-stone-900">{m.label}</p>
                          <p className="text-xs text-stone-500">{formatDateTime(m.createdAt)}</p>
                          <p className="mt-1 text-xs text-stone-600">
                            {m.reason?.trim() ? m.reason : 'Sans motif'}
                          </p>
                          <p className="mt-1 text-[11px] text-stone-400">
                            {accountLabel(m.cashAccountId) || '—'}
                            {m.staffMemberName ? ` · ${m.staffMemberName}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={`text-sm font-semibold tabular-nums ${
                              m.amount >= 0 ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {signedCash(m.amount)}
                          </p>
                          <p className="mt-1 text-[11px] tabular-nums text-stone-400">
                            {formatCashDH(m.balanceBefore)} → {formatCashDH(m.balanceAfter)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    disabled={page <= 1 || historyLoading}
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
                    disabled={page >= totalPages || historyLoading}
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
            </>
          )}
        </section>
      </main>

      {creditOpen && (
        <Modal title="Ajouter à la caisse" onClose={closeModals}>
          {actionStep === 'form' ? (
            <>
              <label className="block text-xs font-medium text-stone-600">Caisse</label>
              <select
                value={actionAccountId}
                onChange={(e) => setActionAccountId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.cashAccountId} value={a.cashAccountId}>
                    {a.name} — {formatCashDH(a.physicalBalance)}
                  </option>
                ))}
              </select>
              <label className="mt-3 block text-xs font-medium text-stone-600">Montant (DH)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={actionAmount}
                onChange={(e) => setActionAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                autoFocus
              />
              <label className="mt-3 block text-xs font-medium text-stone-600">
                Raison <span className="font-normal text-stone-400">(optionnel)</span>
              </label>
              <input
                type="text"
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                placeholder="Ex. complément, erreur"
              />
              {creditPreview && (
                <div className="mt-3 space-y-1 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-700">
                  <p>Solde avant : {formatCashDH(creditPreview.before)}</p>
                  <p>Montant : +{formatCashDH(creditPreview.amount)}</p>
                  <p className="font-semibold">
                    Solde après : {formatCashDH(creditPreview.after)}
                  </p>
                </div>
              )}
              {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModals}
                  className="rounded-lg px-3 py-2 text-xs text-stone-600"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={!creditPreview}
                  onClick={() => {
                    setActionError(null);
                    setActionStep('confirm');
                  }}
                  className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                >
                  Continuer
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-stone-700">
                Confirmer l&apos;ajout de{' '}
                <strong>{formatCashDH(creditPreview?.amount ?? 0)}</strong> sur{' '}
                <strong>{actionAccount?.name}</strong> ?
              </p>
              <p className="mt-2 text-xs text-stone-500">
                Nouveau solde prévu : {formatCashDH(creditPreview?.after ?? 0)}
              </p>
              {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setActionStep('form')}
                  className="rounded-lg px-3 py-2 text-xs text-stone-600"
                >
                  Retour
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void submitCredit()}
                  className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {actionBusy ? 'Enregistrement…' : 'Confirmer'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {withdrawOpen && (
        <Modal title="Retirer de la caisse" onClose={closeModals}>
          {actionStep === 'form' ? (
            <>
              <label className="block text-xs font-medium text-stone-600">Caisse</label>
              <select
                value={actionAccountId}
                onChange={(e) => setActionAccountId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.cashAccountId} value={a.cashAccountId}>
                    {a.name} — {formatCashDH(a.physicalBalance)}
                  </option>
                ))}
              </select>
              <label className="mt-3 block text-xs font-medium text-stone-600">Montant (DH)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={actionAmount}
                onChange={(e) => setActionAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                autoFocus
              />
              <label className="mt-3 block text-xs font-medium text-stone-600">
                Raison <span className="font-normal text-stone-400">(optionnel)</span>
              </label>
              <input
                type="text"
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                placeholder="Ex. dépôt banque"
              />
              {withdrawPreview && (
                <div className="mt-3 space-y-1 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-700">
                  <p>Solde avant : {formatCashDH(withdrawPreview.before)}</p>
                  <p>Montant : −{formatCashDH(withdrawPreview.amount)}</p>
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
                  onClick={closeModals}
                  className="rounded-lg px-3 py-2 text-xs text-stone-600"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={!withdrawPreview || withdrawPreview.insufficient}
                  onClick={() => {
                    setActionError(null);
                    setActionStep('confirm');
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
                <strong>{actionAccount?.name}</strong> ?
              </p>
              <p className="mt-2 text-xs text-stone-500">
                Nouveau solde prévu : {formatCashDH(withdrawPreview?.after ?? 0)}
              </p>
              {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setActionStep('form')}
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
                  {actionBusy ? 'Enregistrement…' : 'Confirmer'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {assignOpen && (
        <Modal title="Affecter une caisse" onClose={closeModals}>
          <label className="block text-xs font-medium text-stone-600">Caisse</label>
          <select
            value={actionAccountId}
            onChange={(e) => {
              const id = e.target.value;
              setActionAccountId(id);
              const row = accounts.find((a) => a.cashAccountId === id);
              setAssignStaffId(row?.staffMemberId ?? '');
            }}
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.cashAccountId} value={a.cashAccountId}>
                {a.name}
                {a.staffMemberName ? ` (${a.staffMemberName})` : ''}
              </option>
            ))}
          </select>
          <label className="mt-3 block text-xs font-medium text-stone-600">Employée</label>
          <select
            value={assignStaffId}
            onChange={(e) => setAssignStaffId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">— Aucune (désaffecter) —</option>
            {actionAccount?.staffMemberId &&
              !assignableStaff.some((s) => s.id === actionAccount.staffMemberId) && (
                <option value={actionAccount.staffMemberId}>
                  {actionAccount.staffMemberName} (actuelle)
                </option>
              )}
            {assignableStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11px] text-stone-400">
            Les mouvements passés conservent leur attribution historique.
          </p>
          {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeModals}
              className="rounded-lg px-3 py-2 text-xs text-stone-600"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={actionBusy || !actionAccount}
              onClick={() => void submitAssign()}
              className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {actionBusy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  emphasis,
  compact,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg';
  emphasis?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        emphasis
          ? 'border-amber-200 bg-amber-50/80 sm:col-span-1'
          : compact
            ? 'border-stone-200 bg-white'
            : 'border-stone-200 bg-white'
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p
        className={`mt-1 tabular-nums ${
          emphasis ? 'text-xl font-semibold text-amber-950' : 'text-base font-semibold'
        } ${
          tone === 'pos'
            ? 'text-emerald-700'
            : tone === 'neg'
              ? 'text-red-700'
              : emphasis
                ? ''
                : 'text-stone-900'
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
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
    <AuthGuard allowedRoles={['OWNER', 'ADMIN']}>
      <CashPageContent />
    </AuthGuard>
  );
}
