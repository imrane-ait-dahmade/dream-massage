/**
 * Pure cash-ledger rules (no database).
 * Money amounts are handled as integer centimes to avoid float drift in tests/logic.
 * Run: npm run test:cash
 */

export type CashMovementType =
  | 'INITIAL_BALANCE'
  | 'SESSION_PAYMENT'
  | 'MANUAL_INCOME'
  | 'WITHDRAWAL'
  | 'ADMIN_ADJUSTMENT'
  | 'CORRECTION'
  | 'REVERSAL'
  | 'PRIME_DEDUCTION';

export const SESSION_REF_TYPE = 'ChairSession' as const;
export const SHIFT_PRIME_REF_TYPE = 'SHIFT_PRIME' as const;

/** Shown when a paid session sync requires a till but none is assigned to the staff member. */
export const NO_CASH_FOR_STAFF_MSG = "Aucune caisse n'est affectée à cette fille.";

/** Empty or whitespace-only reasons are stored as null. */
export function normalizeReason(reason?: string | null): string | null {
  if (reason == null) return null;
  const trimmed = reason.trim();
  return trimmed === '' ? null : trimmed;
}

/** Throws when a ledger movement is required but staff/till context is missing. */
export function assertSessionCashCreditContext(input: {
  plan: { type: CashMovementType; amount: number } | null;
  staffMemberId: string | null;
  cashAccountId: string | null;
}): void {
  if (!input.plan) return;
  if (!input.staffMemberId?.trim()) {
    throw Object.assign(
      new Error('Session sans fille associée (shift requis pour encaissement).'),
      { status: 422 },
    );
  }
  if (!input.cashAccountId?.trim()) {
    throw Object.assign(new Error(NO_CASH_FOR_STAFF_MSG), { status: 422 });
  }
}

/**
 * Validate assigning staff to a physical till (in-memory / service rules).
 * Returns null staffMemberId to clear assignment.
 */
export function planStaffAssignment(input: {
  staffMemberId: string | null;
  staffExists: boolean;
  staffActive: boolean;
  staffAlreadyOnOtherTill: string | null;
}): { staffMemberId: string | null } {
  if (input.staffMemberId == null || input.staffMemberId === '') {
    return { staffMemberId: null };
  }
  if (!input.staffExists) {
    throw Object.assign(new Error('Staff introuvable'), { status: 404 });
  }
  if (!input.staffActive) {
    throw Object.assign(new Error('Cette fille est inactive.'), { status: 400 });
  }
  if (input.staffAlreadyOnOtherTill) {
    throw Object.assign(
      new Error(`Cette fille est déjà affectée à une autre caisse (${input.staffAlreadyOnOtherTill}).`),
      { status: 409 },
    );
  }
  return { staffMemberId: input.staffMemberId };
}

/** Convert DH amount to integer centimes (rounded half-up). */
export function toCents(amount: number | string): number {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error('Montant invalide.'), { status: 400 });
  }
  return Math.round(n * 100);
}

/** Centimes → DH number with exactly 2 decimals (still a JS number, but quantized). */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function round2(n: number): number {
  return fromCents(toCents(n));
}

export function assertPositiveAmount(amount: number, label = 'montant'): number {
  const cents = toCents(amount);
  if (cents <= 0) {
    throw Object.assign(new Error(`Le ${label} doit être strictement positif.`), { status: 400 });
  }
  return fromCents(cents);
}

export function assertNonNegativeMoney(amount: number): number {
  const cents = toCents(amount);
  if (cents < 0) {
    throw Object.assign(new Error('Le montant ne peut pas être négatif.'), { status: 400 });
  }
  return fromCents(cents);
}

/**
 * Cutover opening balance for an empty ledger account.
 * Rejects second init and init after any prior movement.
 */
export function planInitialBalance(input: {
  countedAmount: number;
  currentBalance: number;
  movementCount: number;
  hasInitialBalance: boolean;
}): { type: 'INITIAL_BALANCE'; amount: number; balanceBefore: number; balanceAfter: number } {
  if (input.hasInitialBalance) {
    throw Object.assign(
      new Error('Cette caisse a déjà un solde initial (INITIAL_BALANCE).'),
      { status: 409 },
    );
  }
  if (input.movementCount > 0) {
    throw Object.assign(
      new Error(
        'Cutover impossible : la caisse a déjà des mouvements. Utilisez une correction admin si nécessaire.',
      ),
      { status: 409 },
    );
  }
  const amount = assertNonNegativeMoney(input.countedAmount);
  const before = round2(input.currentBalance);
  if (before !== 0) {
    throw Object.assign(
      new Error(`Cutover impossible : solde actuel ${before} DH (attendu 0).`),
      { status: 409 },
    );
  }
  return {
    type: 'INITIAL_BALANCE',
    amount,
    balanceBefore: 0,
    balanceAfter: amount,
  };
}

export function sumNetForReference(amounts: number[]): number {
  return fromCents(amounts.reduce((s, a) => s + toCents(a), 0));
}

export function assertWithdrawAmount(balance: number, amount: number): void {
  const withdrawCents = toCents(amount);
  if (withdrawCents <= 0) {
    throw Object.assign(new Error('Le montant du retrait doit être strictement positif.'), {
      status: 400,
    });
  }
  if (withdrawCents > toCents(balance)) {
    throw Object.assign(
      new Error(`Retrait impossible : solde insuffisant (${round2(balance)} DH).`),
      { status: 400 },
    );
  }
}

/** Admin sets desired balance → signed delta movement. */
export function planAdjustment(currentBalance: number, desiredBalance: number): {
  type: 'ADMIN_ADJUSTMENT';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
} {
  if (!Number.isFinite(desiredBalance)) {
    throw Object.assign(new Error('Solde cible invalide.'), { status: 400 });
  }
  const beforeCents = toCents(currentBalance);
  const afterCents = toCents(desiredBalance);
  const deltaCents = afterCents - beforeCents;
  if (deltaCents === 0) {
    throw Object.assign(new Error('Le solde est déjà à cette valeur.'), { status: 400 });
  }
  return {
    type: 'ADMIN_ADJUSTMENT',
    amount: fromCents(deltaCents),
    balanceBefore: fromCents(beforeCents),
    balanceAfter: fromCents(afterCents),
  };
}

export function applySignedAmount(balanceBefore: number, amount: number): {
  balanceBefore: number;
  balanceAfter: number;
} {
  const beforeCents = toCents(balanceBefore);
  const afterCents = beforeCents + toCents(amount);
  return {
    balanceBefore: fromCents(beforeCents),
    balanceAfter: fromCents(afterCents),
  };
}

/**
 * Idempotent credit planning:
 * - same (referenceType, referenceId) already credited → skip (null)
 * - otherwise post positive credit of given type
 */
export function planIdempotentCredit(input: {
  amount: number;
  type: CashMovementType;
  alreadyExistsForReference: boolean;
}): { type: CashMovementType; amount: number } | null {
  if (input.alreadyExistsForReference) return null;
  const amount = assertPositiveAmount(input.amount);
  return { type: input.type, amount };
}

/**
 * Business paid target for cash ledger sync.
 * correctedAmount wins when set; otherwise expectedAmount; else 0.
 */
export function resolveSessionPaidTarget(
  correctedAmount: number | null | undefined,
  expectedAmount: number | null | undefined,
): number {
  if (correctedAmount != null) return round2(correctedAmount);
  if (expectedAmount != null) return round2(expectedAmount);
  return 0;
}

/** Validate staff/till when a first credit would occur after cutover. */
export function assertNewSessionCashCreditAllowed(input: {
  targetPaid: number;
  hasLedgerHistory: boolean;
  sessionFinancialAt: Date | null;
  /** Earliest cutover across physical tills (null = tracking not configured). */
  globalTrackingStartedAt: Date | null;
  staffMemberId: string | null;
  cashAccountId: string | null;
}): void {
  if (input.targetPaid <= 0 || input.hasLedgerHistory) return;
  if (!input.globalTrackingStartedAt || !input.sessionFinancialAt) return;
  if (input.sessionFinancialAt.getTime() < input.globalTrackingStartedAt.getTime()) return;

  if (!input.staffMemberId?.trim()) {
    throw Object.assign(
      new Error('Session sans fille associée (shift requis pour encaissement).'),
      { status: 422 },
    );
  }
  if (!input.cashAccountId?.trim()) {
    throw Object.assign(new Error(NO_CASH_FOR_STAFF_MSG), { status: 422 });
  }
}
/**
 * First SESSION_PAYMENT is allowed only after cash cutover on the till,
 * unless the session already has ledger history (delta sync continues).
 */
export function shouldAllowSessionCashCredit(input: {
  sessionFinancialAt: Date | null;
  cashTrackingStartedAt: Date | null;
  hasLedgerHistory: boolean;
}): boolean {
  if (input.hasLedgerHistory) return true;
  if (!input.cashTrackingStartedAt) return false;
  if (!input.sessionFinancialAt) return false;
  return input.sessionFinancialAt.getTime() >= input.cashTrackingStartedAt.getTime();
}

/**
 * Bring ledger net for a ChairSession to paidTarget = correctedAmount ?? expectedAmount.
 *
 * targetPaid 0 = no cash contribution (TOO_SHORT / unset).
 * Legacy / cutover: no first credit before cashTrackingStartedAt on the till.
 */
export function planSessionPaidSync(input: {
  netCredited: number;
  hasLedgerHistory: boolean;
  hasSessionPayment: boolean;
  /** paid target before this write */
  previousTargetPaid: number;
  /** paid target after this write */
  targetPaid: number;
  /** false → skip first credit (pre-cutover sessions) */
  allowFirstCredit: boolean;
}): { type: CashMovementType; amount: number } | null {
  const target = round2(input.targetPaid);
  if (target < 0) {
    throw Object.assign(new Error('Le montant encaissé ne peut pas être négatif.'), { status: 400 });
  }

  const net = round2(input.netCredited);
  const delta = round2(target - net);
  if (delta === 0) return null;

  if (!input.allowFirstCredit && !input.hasLedgerHistory) {
    return null;
  }

  // First recording after cutover: net 0 → positive paid target.
  if (!input.hasSessionPayment && net === 0 && target > 0) {
    return { type: 'SESSION_PAYMENT', amount: target };
  }

  // Target cleared to zero while ledger has balance.
  if (target === 0 && net !== 0) {
    return { type: 'REVERSAL', amount: delta };
  }

  return { type: 'CORRECTION', amount: delta };
}

/**
 * Positive prime already deducted from till (sum of PRIME_DEDUCTION is negative).
 * Example: movements -20 → returns 20.
 */
export function netPrimeDeductedFromMovements(amounts: number[]): number {
  const netCents = amounts.reduce((s, a) => s + toCents(a), 0);
  return fromCents(-netCents);
}

/**
 * First prime deduction allowed when shift is post-cutover OR shift sessions
 * already have ledger history OR prime was already synced for this shift.
 */
export function shouldAllowShiftPrimeDeduction(input: {
  hasPrimeLedgerHistory: boolean;
  shiftStartedAt: Date | null;
  cashTrackingStartedAt: Date | null;
  hasSessionPaymentsInLedger: boolean;
}): boolean {
  if (input.hasPrimeLedgerHistory) return true;
  if (input.hasSessionPaymentsInLedger) return true;
  if (!input.cashTrackingStartedAt || !input.shiftStartedAt) return false;
  return input.shiftStartedAt.getTime() >= input.cashTrackingStartedAt.getTime();
}

/**
 * Idempotent shift prime sync: desiredPrime vs already deducted → signed PRIME_DEDUCTION delta.
 * Positive delta (more prime owed) → negative movement; decrease → positive restitution.
 */
export function planShiftPrimeSync(input: {
  desiredPrime: number;
  alreadyDeductedPrime: number;
  allowFirstDeduction: boolean;
  hasPrimeLedgerHistory: boolean;
}): { type: 'PRIME_DEDUCTION'; amount: number } | null {
  const desired = round2(input.desiredPrime);
  if (desired < 0) {
    throw Object.assign(new Error('La prime ne peut pas être négative.'), { status: 400 });
  }
  const already = round2(input.alreadyDeductedPrime);
  const delta = round2(desired - already);
  if (delta === 0) return null;

  if (!input.allowFirstDeduction && !input.hasPrimeLedgerHistory) {
    return null;
  }

  return { type: 'PRIME_DEDUCTION', amount: round2(-delta) };
}

/** Reverse a prior movement: opposite signed amount as REVERSAL. */
export function planReversal(originalAmount: number): {
  type: 'REVERSAL';
  amount: number;
} {
  const cents = toCents(originalAmount);
  if (cents === 0) {
    throw Object.assign(new Error('Impossible d’annuler un mouvement à 0.'), { status: 400 });
  }
  return { type: 'REVERSAL', amount: fromCents(-cents) };
}

const SESSION_INCOME_TYPES: CashMovementType[] = [
  'SESSION_PAYMENT',
  'CORRECTION',
  'REVERSAL',
];

const ADJUSTMENT_TYPES: CashMovementType[] = [
  'ADMIN_ADJUSTMENT',
  'MANUAL_INCOME',
  'INITIAL_BALANCE',
];

/** @deprecated use sessionIncome — kept for backward-compatible dailyIncome */
const INCOME_TYPES: CashMovementType[] = [
  'SESSION_PAYMENT',
  'MANUAL_INCOME',
  'INITIAL_BALANCE',
];

/**
 * Daily stats from current_balance + today's movements only.
 * opening = current - sum(today amounts); closing = current (net after primes).
 */
export function computeDayStats(input: {
  currentBalance: number;
  todayMovements: Array<{ type: CashMovementType; amount: number }>;
}): {
  openingBalance: number;
  sessionIncome: number;
  primeDeductions: number;
  withdrawals: number;
  adjustments: number;
  closingBalance: number;
  /** @deprecated alias of sessionIncome + manual/initial (legacy) */
  dailyIncome: number;
  /** @deprecated alias of sessionIncome + manual/initial (legacy) */
  incomes: number;
  /** @deprecated alias of closingBalance */
  currentBalance: number;
} {
  const currentCents = toCents(input.currentBalance);
  let sessionIncomeCents = 0;
  let primeCents = 0;
  let withdrawalCents = 0;
  let adjustmentCents = 0;
  let legacyIncomeCents = 0;
  let todayNetCents = 0;

  for (const m of input.todayMovements) {
    const a = toCents(m.amount);
    todayNetCents += a;
    if (m.type === 'WITHDRAWAL') {
      withdrawalCents += Math.abs(a);
    } else if (m.type === 'PRIME_DEDUCTION') {
      primeCents += a;
    } else if (SESSION_INCOME_TYPES.includes(m.type)) {
      sessionIncomeCents += a;
    } else if (ADJUSTMENT_TYPES.includes(m.type)) {
      adjustmentCents += a;
    } else {
      adjustmentCents += a;
    }
  }

  const manualInitialCents = input.todayMovements
    .filter((m) => m.type === 'MANUAL_INCOME' || m.type === 'INITIAL_BALANCE')
    .reduce((s, m) => s + toCents(m.amount), 0);
  legacyIncomeCents = sessionIncomeCents + manualInitialCents;

  const opening = fromCents(currentCents - todayNetCents);
  const sessionIncome = fromCents(sessionIncomeCents);
  const incomes = fromCents(legacyIncomeCents);
  const closing = fromCents(currentCents);

  return {
    openingBalance: opening,
    sessionIncome,
    primeDeductions: fromCents(primeCents),
    withdrawals: fromCents(withdrawalCents),
    adjustments: fromCents(adjustmentCents),
    closingBalance: closing,
    dailyIncome: incomes,
    incomes,
    currentBalance: closing,
  };
}

export function movementLabel(type: CashMovementType): string {
  switch (type) {
    case 'INITIAL_BALANCE':
      return 'Solde initial';
    case 'SESSION_PAYMENT':
      return 'Paiement session';
    case 'MANUAL_INCOME':
      return 'Entrée manuelle';
    case 'WITHDRAWAL':
      return 'Retrait admin';
    case 'ADMIN_ADJUSTMENT':
      return 'Ajustement admin';
    case 'CORRECTION':
      return 'Correction';
    case 'REVERSAL':
      return 'Annulation';
    case 'PRIME_DEDUCTION':
      return 'Prime';
    default:
      return type;
  }
}

// ── In-memory ledger for concurrency / rollback / pagination unit tests ───────

export type MemoryMovement = {
  id: string;
  cashAccountId: string;
  staffMemberId: string | null;
  type: CashMovementType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  createdAt: number;
};

export type MemoryAccount = {
  cashAccountId: string;
  code: string;
  currentBalance: number;
  /** Current staff assignment on this till (not movement history). */
  assignedStaffMemberId: string | null;
  /** Cutover timestamp — sessions before this do not get first SESSION_PAYMENT. */
  cashTrackingStartedAt: Date | null;
  movements: MemoryMovement[];
};

/** Minimal transactional ledger (physical tills) used by tests. */
export class MemoryCashLedger {
  private accounts = new Map<string, MemoryAccount>();
  private seq = 0;
  private locks = new Map<string, Promise<void>>();

  constructor(seed: Array<{ id: string; code: string }> = [
    { id: 'CASH_1', code: 'CASH_1' },
    { id: 'CASH_2', code: 'CASH_2' },
  ]) {
    for (const s of seed) {
      this.accounts.set(s.id, {
        cashAccountId: s.id,
        code: s.code,
        currentBalance: 0,
        assignedStaffMemberId: null,
        cashTrackingStartedAt: new Date(0),
        movements: [],
      });
    }
  }

  private async withLock<T>(cashAccountId: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.locks.get(cashAccountId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.locks.set(cashAccountId, prev.then(() => gate));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  requireAccount(cashAccountId: string): MemoryAccount {
    const acc = this.accounts.get(cashAccountId);
    if (!acc) {
      throw Object.assign(new Error('Caisse introuvable'), { status: 404 });
    }
    return acc;
  }

  getBalance(cashAccountId: string): number {
    return this.accounts.get(cashAccountId)?.currentBalance ?? 0;
  }

  storeTotal(): number {
    let t = 0;
    for (const a of this.accounts.values()) t = round2(t + a.currentBalance);
    return t;
  }

  /** Current assignment: which till is linked to this staff member. */
  resolveCashAccountForStaff(staffMemberId: string | null | undefined): string | null {
    if (!staffMemberId?.trim()) return null;
    for (const acc of this.accounts.values()) {
      if (acc.assignedStaffMemberId === staffMemberId) return acc.cashAccountId;
    }
    return null;
  }

  getAssignedStaff(cashAccountId: string): string | null {
    return this.accounts.get(cashAccountId)?.assignedStaffMemberId ?? null;
  }

  assignStaffToCashAccount(cashAccountId: string, staffMemberId: string | null) {
    const acc = this.requireAccount(cashAccountId);
    if (staffMemberId) {
      const other = [...this.accounts.values()].find(
        (a) => a.cashAccountId !== cashAccountId && a.assignedStaffMemberId === staffMemberId,
      );
      planStaffAssignment({
        staffMemberId,
        staffExists: true,
        staffActive: true,
        staffAlreadyOnOtherTill: other?.code ?? null,
      });
    }
    acc.assignedStaffMemberId = staffMemberId;
    return acc;
  }

  async credit(input: {
    cashAccountId: string;
    staffMemberId?: string | null;
    amount: number;
    type?: CashMovementType;
    referenceType?: string | null;
    referenceId?: string | null;
    reason?: string | null;
    failAfterLock?: boolean;
  }): Promise<MemoryMovement | null> {
    return this.withLock(input.cashAccountId, () => {
      const acc = this.requireAccount(input.cashAccountId);
      const type = input.type ?? 'MANUAL_INCOME';
      const refType = input.referenceType ?? null;
      const refId = input.referenceId ?? null;
      const staffMemberId = input.staffMemberId ?? null;

      if (refType && refId) {
        const exists = this.allMovements().some(
          (m) => m.referenceType === refType && m.referenceId === refId && m.type === type,
        );
        const plan = planIdempotentCredit({
          amount: input.amount,
          type,
          alreadyExistsForReference: exists,
        });
        if (!plan) return null;
        if (input.failAfterLock) throw new Error('ROLLBACK_TEST');
        return this.post(acc, staffMemberId, plan.type, plan.amount, refType, refId, normalizeReason(input.reason));
      }

      const amount = assertPositiveAmount(input.amount);
      if (input.failAfterLock) throw new Error('ROLLBACK_TEST');
      return this.post(acc, staffMemberId, type, amount, refType, refId, normalizeReason(input.reason));
    });
  }

  async withdraw(
    cashAccountId: string,
    amount: number,
    reason?: string | null,
    staffMemberId?: string | null,
  ) {
    return this.withLock(cashAccountId, () => {
      const acc = this.requireAccount(cashAccountId);
      const positive = assertPositiveAmount(amount, 'montant du retrait');
      assertWithdrawAmount(acc.currentBalance, positive);
      return this.post(acc, staffMemberId ?? null, 'WITHDRAWAL', -positive, null, null, normalizeReason(reason));
    });
  }

  async adjust(
    cashAccountId: string,
    desiredBalance: number,
    reason?: string | null,
    staffMemberId?: string | null,
  ) {
    return this.withLock(cashAccountId, () => {
      const acc = this.requireAccount(cashAccountId);
      const plan = planAdjustment(acc.currentBalance, desiredBalance);
      return this.post(
        acc,
        staffMemberId ?? null,
        plan.type,
        plan.amount,
        null,
        null,
        normalizeReason(reason),
      );
    });
  }

  async setInitialBalance(
    cashAccountId: string,
    countedAmount: number,
    reason?: string | null,
  ): Promise<MemoryMovement> {
    return this.withLock(cashAccountId, () => {
      const acc = this.requireAccount(cashAccountId);
      const plan = planInitialBalance({
        countedAmount,
        currentBalance: acc.currentBalance,
        movementCount: acc.movements.length,
        hasInitialBalance: acc.movements.some((m) => m.type === 'INITIAL_BALANCE'),
      });
      const movement = this.post(
        acc,
        null,
        plan.type,
        plan.amount,
        null,
        null,
        reason ?? 'Cutover caisse production',
      );
      acc.cashTrackingStartedAt = new Date(movement.createdAt);
      return movement;
    });
  }

  /** Set cutover boundary for auto session sync tests. */
  setCashTrackingStartedAt(cashAccountId: string, at: Date | null) {
    const acc = this.requireAccount(cashAccountId);
    acc.cashTrackingStartedAt = at;
  }

  async reverse(cashAccountId: string, movementId: string, reason?: string | null) {
    return this.withLock(cashAccountId, () => {
      const acc = this.requireAccount(cashAccountId);
      const original = acc.movements.find((m) => m.id === movementId);
      if (!original) throw Object.assign(new Error('Mouvement introuvable.'), { status: 404 });
      if (original.type === 'REVERSAL') {
        throw Object.assign(new Error('Impossible d’annuler une annulation.'), { status: 400 });
      }
      const already = acc.movements.some(
        (m) =>
          m.type === 'REVERSAL' &&
          m.referenceType === 'CashMovement' &&
          m.referenceId === movementId,
      );
      if (already) {
        throw Object.assign(new Error('Ce mouvement a déjà été annulé.'), { status: 409 });
      }
      const plan = planReversal(original.amount);
      return this.post(
        acc,
        original.staffMemberId,
        plan.type,
        plan.amount,
        'CashMovement',
        movementId,
        reason ?? `Annulation de ${movementId}`,
      );
    });
  }

  /** Earliest cutover timestamp across physical tills. */
  earliestTrackingStartedAt(): Date | null {
    let min: number | null = null;
    for (const acc of this.accounts.values()) {
      if (!acc.cashTrackingStartedAt) continue;
      const t = acc.cashTrackingStartedAt.getTime();
      if (min == null || t < min) min = t;
    }
    return min == null ? null : new Date(min);
  }

  /**
   * Sync session paid → physical till (sticky cashAccountId once credited).
   */
  async syncSessionPaid(input: {
    cashAccountId: string | null;
    staffMemberId: string | null;
    sessionId: string;
    previousTargetPaid: number;
    targetPaid: number;
    sessionFinancialAt?: Date | null;
    reason?: string | null;
    failAfterPlan?: boolean;
  }): Promise<MemoryMovement | null> {
    const related = this.allMovements().filter(
      (m) => m.referenceType === SESSION_REF_TYPE && m.referenceId === input.sessionId,
    );
    const stickyTill = related.length > 0 ? related[0]!.cashAccountId : null;
    const staffMemberId = input.staffMemberId;
    const prospectiveTill =
      stickyTill ??
      input.cashAccountId ??
      (staffMemberId ? this.resolveCashAccountForStaff(staffMemberId) : null);
    const trackingAt = prospectiveTill
      ? (this.accounts.get(prospectiveTill)?.cashTrackingStartedAt ?? null)
      : null;
    const sessionFinancialAt = input.sessionFinancialAt ?? new Date();
    const globalTrackingStartedAt = this.earliestTrackingStartedAt();

    assertNewSessionCashCreditAllowed({
      targetPaid: input.targetPaid,
      hasLedgerHistory: related.length > 0,
      sessionFinancialAt,
      globalTrackingStartedAt,
      staffMemberId,
      cashAccountId: prospectiveTill,
    });

    const resolvedTill = prospectiveTill;
    const netCredited = sumNetForReference(related.map((m) => m.amount));
    const allowFirstCredit = shouldAllowSessionCashCredit({
      sessionFinancialAt,
      cashTrackingStartedAt: trackingAt,
      hasLedgerHistory: related.length > 0,
    });
    const plan = planSessionPaidSync({
      netCredited,
      hasLedgerHistory: related.length > 0,
      hasSessionPayment: related.some((m) => m.type === 'SESSION_PAYMENT'),
      previousTargetPaid: input.previousTargetPaid,
      targetPaid: input.targetPaid,
      allowFirstCredit,
    });

    if (allowFirstCredit || related.length > 0) {
      assertSessionCashCreditContext({
        plan,
        staffMemberId,
        cashAccountId: resolvedTill,
      });
    }
    if (!plan || !resolvedTill) return null;
    if (input.failAfterPlan) throw new Error('ROLLBACK_TEST');

    return this.withLock(resolvedTill, () => {
      const acc = this.requireAccount(resolvedTill);
      return this.post(
        acc,
        staffMemberId,
        plan.type,
        plan.amount,
        SESSION_REF_TYPE,
        input.sessionId,
        input.reason ?? null,
      );
    });
  }

  netForSession(sessionId: string): number {
    return sumNetForReference(
      this.allMovements()
        .filter((m) => m.referenceType === SESSION_REF_TYPE && m.referenceId === sessionId)
        .map((m) => m.amount),
    );
  }

  netPrimeForShift(shiftId: string): number {
    return netPrimeDeductedFromMovements(
      this.allMovements()
        .filter(
          (m) =>
            m.referenceType === SHIFT_PRIME_REF_TYPE &&
            m.referenceId === shiftId &&
            m.type === 'PRIME_DEDUCTION',
        )
        .map((m) => m.amount),
    );
  }

  cashAccountIdForShiftPrime(shiftId: string): string | null {
    const m = this.allMovements().find(
      (x) => x.referenceType === SHIFT_PRIME_REF_TYPE && x.referenceId === shiftId,
    );
    return m?.cashAccountId ?? null;
  }

  /**
   * Sync shift prime → physical till (sticky cashAccountId once credited).
   * desiredPrime comes from PrimeCalculationService in production.
   */
  async syncShiftPrime(input: {
    shiftId: string;
    staffMemberId: string | null;
    cashAccountId: string | null;
    desiredPrime: number;
    shiftStartedAt?: Date | null;
    hasSessionPaymentsInLedger?: boolean;
    reason?: string | null;
  }): Promise<MemoryMovement | null> {
    const related = this.allMovements().filter(
      (m) => m.referenceType === SHIFT_PRIME_REF_TYPE && m.referenceId === input.shiftId,
    );
    const primeMovements = related.filter((m) => m.type === 'PRIME_DEDUCTION');
    const stickyTill = primeMovements.length > 0 ? primeMovements[0]!.cashAccountId : null;
    const staffMemberId = input.staffMemberId;
    let prospectiveTill = stickyTill;
    if (!prospectiveTill && staffMemberId) {
      prospectiveTill = this.resolveCashAccountForStaff(staffMemberId);
    }
    if (!prospectiveTill) {
      prospectiveTill = input.cashAccountId;
    }
    if (!prospectiveTill) return null;

    return this.withLock(prospectiveTill, () => {
      const freshRelated = this.allMovements().filter(
        (m) => m.referenceType === SHIFT_PRIME_REF_TYPE && m.referenceId === input.shiftId,
      );
      const freshPrime = freshRelated.filter((m) => m.type === 'PRIME_DEDUCTION');
      const trackingAt =
        this.accounts.get(prospectiveTill!)?.cashTrackingStartedAt ?? null;
      const shiftStartedAt = input.shiftStartedAt ?? new Date(0);
      const alreadyDeducted = netPrimeDeductedFromMovements(freshPrime.map((m) => m.amount));
      const allowFirstDeduction = shouldAllowShiftPrimeDeduction({
        hasPrimeLedgerHistory: freshPrime.length > 0,
        shiftStartedAt,
        cashTrackingStartedAt: trackingAt,
        hasSessionPaymentsInLedger: input.hasSessionPaymentsInLedger ?? false,
      });
      const plan = planShiftPrimeSync({
        desiredPrime: input.desiredPrime,
        alreadyDeductedPrime: alreadyDeducted,
        allowFirstDeduction,
        hasPrimeLedgerHistory: freshPrime.length > 0,
      });
      if (!plan) return null;
      const acc = this.requireAccount(prospectiveTill!);
      return this.post(
        acc,
        staffMemberId,
        plan.type,
        plan.amount,
        SHIFT_PRIME_REF_TYPE,
        input.shiftId,
        input.reason ?? null,
      );
    });
  }

  cashAccountIdForSession(sessionId: string): string | null {
    const m = this.allMovements().find(
      (x) => x.referenceType === SESSION_REF_TYPE && x.referenceId === sessionId,
    );
    return m?.cashAccountId ?? null;
  }

  listMovements(filters: {
    cashAccountId?: string | null;
    staffMemberId?: string | null;
    page?: number;
    pageSize?: number;
  } = {}) {
    let all = this.allMovements().sort((a, b) => b.createdAt - a.createdAt);
    if (filters.cashAccountId) {
      all = all.filter((m) => m.cashAccountId === filters.cashAccountId);
    }
    if (filters.staffMemberId) {
      all = all.filter((m) => m.staffMemberId === filters.staffMemberId);
    }
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = filters.pageSize ?? 25;
    const total = all.length;
    const start = (page - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0,
    };
  }

  dayStats(cashAccountId: string, dayStartMs: number, dayEndMs: number, staffMemberId?: string | null) {
    const acc = this.requireAccount(cashAccountId);
    let today = acc.movements.filter((m) => m.createdAt >= dayStartMs && m.createdAt < dayEndMs);
    if (staffMemberId) today = today.filter((m) => m.staffMemberId === staffMemberId);
    return {
      physicalBalance: acc.currentBalance,
      ...computeDayStats({
        currentBalance: acc.currentBalance,
        todayMovements: today.map((m) => ({ type: m.type, amount: m.amount })),
      }),
    };
  }

  private allMovements(): MemoryMovement[] {
    const out: MemoryMovement[] = [];
    for (const a of this.accounts.values()) out.push(...a.movements);
    return out;
  }

  private post(
    acc: MemoryAccount,
    staffMemberId: string | null,
    type: CashMovementType,
    amount: number,
    referenceType: string | null,
    referenceId: string | null,
    reason: string | null,
  ): MemoryMovement {
    const { balanceBefore, balanceAfter } = applySignedAmount(acc.currentBalance, amount);
    const movement: MemoryMovement = {
      id: `m${++this.seq}`,
      cashAccountId: acc.cashAccountId,
      staffMemberId,
      type,
      amount: round2(amount),
      balanceBefore,
      balanceAfter,
      referenceType,
      referenceId,
      reason,
      createdAt: this.seq,
    };
    acc.movements.push(movement);
    acc.currentBalance = balanceAfter;
    return movement;
  }
}
