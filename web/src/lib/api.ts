import type {
  DashboardState,
  ChairOverview,
  ChairSessionsResponse,
  SettingsChair,
  PricingPlan,
  PricingRule,
  StaffMember,
  SystemSettings,
  RevenueStats,
  PrimeSettingsSummary,
  ShiftTypeSetting,
  CommissionRuleSetting,
  TargetBonusRuleSetting,
  CommissionType,
  StaffScheduleItem,
  WeeklyScheduleDay,
  TodayShiftSuggestion,
  HomeDashboardFilters,
  HomeDashboardResponse,
  SessionDetail,
  SessionSettings,
  SessionCorrectionPayload,
  AssistantMeResponse,
  AssistantDashboardResponse,
  AssistantSessionsListResponse,
  SettingsUser,
  SettingsUserRole,
  ShiftAutomationStatus,
  AutoShiftCheckResult,
  OpenShift,
  SessionPlanChangeRequest,
  SessionPlanChangeRequestStatus,
  SessionPlanChangeResult,
} from './types';

const DEV_API_FALLBACK = 'http://localhost:4001';
const API_TIMEOUT_MS = 15_000;

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'server'
  | 'unavailable'
  | 'client';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly url: string;
  readonly retryAfterSec?: number;

  constructor(
    message: string,
    kind: ApiErrorKind,
    url: string,
    status?: number,
    retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.url = url;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!raw) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        `[api] NEXT_PUBLIC_API_URL not set — using fallback ${DEV_API_FALLBACK}`,
      );
      return DEV_API_FALLBACK;
    }
    throw new ApiError(
      'NEXT_PUBLIC_API_URL est manquant. Configurez l’URL du backend.',
      'network',
      '(no base URL)',
    );
  }
  try {
    new URL(raw);
  } catch {
    throw new ApiError(`NEXT_PUBLIC_API_URL invalide : ${raw}`, 'network', raw);
  }
  return raw;
}

const BASE = getApiBaseUrl();

if (process.env.NODE_ENV === 'development') {
  console.log('[api] NEXT_PUBLIC_API_URL =', process.env.NEXT_PUBLIC_API_URL ?? '(not set — using fallback)');
  console.log('[api] Base URL =', BASE);
  console.log('[api] Timeout =', API_TIMEOUT_MS, 'ms');
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function mapFetchError(err: unknown, url: string): ApiError {
  if (isAbortError(err)) {
    return new ApiError(
      'Délai dépassé — le serveur met trop de temps à répondre.',
      'timeout',
      url,
    );
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (
    raw === 'Failed to fetch' ||
    raw.includes('NetworkError') ||
    raw.includes('ECONNREFUSED') ||
    raw.includes('ENOTFOUND')
  ) {
    return new ApiError(
      `Impossible de contacter le serveur (${BASE}). Vérifiez que le backend est démarré et que NEXT_PUBLIC_API_URL correspond au port du serveur.`,
      'network',
      url,
    );
  }
  return new ApiError(raw || 'Erreur réseau', 'network', url);
}

// ── Bearer token storage (Safari/iOS cross-origin fallback) ────────────────────
// Cookie auth is preferred; when Safari blocks the cross-site httpOnly cookie
// we fall back to a localStorage Bearer token. The backend accepts both.

const TOKEN_KEY = 'dream_care_token';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getDashboardState(): Promise<DashboardState> {
  if (process.env.NODE_ENV === 'development') {
    console.log('[api] GET', `${BASE}/api/dashboard/state`);
  }
  const res = await fetch(`${BASE}/api/dashboard/state`, {
    cache: 'no-store',
    credentials: 'include',
    headers: authHeaders(),
    signal: AbortSignal.timeout(6000),
  });
  if (res.status === 401) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.replace('/login');
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<DashboardState>;
}

export async function getChairOverview(chairIdOrName: string): Promise<ChairOverview> {
  const res = await fetch(
    `${BASE}/api/chairs/${encodeURIComponent(chairIdOrName)}/overview`,
    { cache: 'no-store', credentials: 'include', headers: authHeaders(), signal: AbortSignal.timeout(6000) },
  );
  if (res.status === 401) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.replace('/login');
    }
    throw new Error('Unauthorized');
  }
  if (res.status === 404) throw new Error('CHAIR_NOT_FOUND');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ChairOverview>;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export type UserRole = 'OWNER' | 'ADMIN' | 'ASSISTANT';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  staffMemberId?: string | null;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json()) as { ok: boolean; token?: string; user?: AuthUser; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  if (process.env.NODE_ENV === 'development') {
    console.log('[auth] login response: token', body.token ? 'present' : 'absent');
  }
  // Store token for Bearer fallback (Safari cross-origin — cookie may be blocked)
  if (body.token) storeToken(body.token);
  return body.user!;
}

export async function getMe(): Promise<AuthUser> {
  return apiRequest<{ ok: boolean; user: AuthUser }>(`${BASE}/api/auth/me`).then((r) => r.user);
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  clearToken();
}

// ── Settings helpers ───────────────────────────────────────────────────────────

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  if (process.env.NODE_ENV === 'development') {
    console.log(`[api] ${method} ${url}`);
  }

  const callerHeaders = (init?.headers ?? {}) as Record<string, string>;
  const { signal: callerSignal, headers: _ignoredHeaders, ...restInit } = init ?? {};
  const timeoutSignal = AbortSignal.timeout(API_TIMEOUT_MS);
  const signal =
    callerSignal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : callerSignal ?? timeoutSignal;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      ...restInit,
      signal,
      headers: { ...authHeaders(), ...callerHeaders },
    });
  } catch (err) {
    const apiErr = mapFetchError(err, url);
    if (process.env.NODE_ENV === 'development') {
      console.error('[api] fetch failed', {
        method,
        url,
        kind: apiErr.kind,
        message: apiErr.message,
        cause: err,
      });
    }
    throw apiErr;
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[api] ${method} ${url} → ${res.status}`);
  }

  if (res.status === 401) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.replace('/login');
    }
    throw new ApiError('Session expirée — reconnectez-vous.', 'unauthorized', url, 401);
  }
  if (res.status === 403) {
    throw new ApiError('Accès refusé.', 'forbidden', url, 403);
  }
  if (res.status === 503) {
    const retryRaw = res.headers.get('Retry-After');
    const retryAfterSec = retryRaw ? Math.max(1, parseInt(retryRaw, 10) || 60) : 60;
    throw new ApiError(
      'Service temporairement indisponible. Nouvelle tentative automatique.',
      'unavailable',
      url,
      503,
      retryAfterSec,
    );
  }
  if (!res.ok) {
    let msg = `Erreur serveur (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      if (body.error) msg = body.error;
      else if (body.detail) msg = body.detail;
    } catch { /* ignore */ }
    const kind: ApiErrorKind = res.status >= 500 ? 'server' : 'client';
    throw new ApiError(msg, kind, url, res.status);
  }
  return res.json() as Promise<T>;
}

// ── Settings — chairs ──────────────────────────────────────────────────────────

export async function getSettingsChairs(): Promise<{ items: SettingsChair[] }> {
  return apiRequest(`${BASE}/api/settings/chairs`);
}

export async function updateChair(
  chairId: string,
  payload: { displayName?: string; isEnabled?: boolean },
): Promise<SettingsChair> {
  return apiRequest(`${BASE}/api/settings/chairs/${encodeURIComponent(chairId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateChairDetectionConfig(
  chairId: string,
  payload: {
    startThresholdWatts: number;
    stopThresholdWatts: number;
    startConfirmSeconds: number;
    stopConfirmSeconds: number;
    activationDelaySeconds: number;
    baselinePowerWatts?: number | null;
  },
): Promise<unknown> {
  return apiRequest(
    `${BASE}/api/settings/chairs/${encodeURIComponent(chairId)}/detection-config`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
  );
}

// ── Settings — pricing ─────────────────────────────────────────────────────────

export async function getPricingPlans(): Promise<{ items: PricingPlan[] }> {
  return apiRequest(`${BASE}/api/settings/pricing/plans`);
}

export async function createPricingPlan(payload: {
  name: string;
  durationSeconds: number;
  priceAmount: number;
  currency?: string;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<PricingPlan> {
  return apiRequest(`${BASE}/api/settings/pricing/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updatePricingPlan(
  planId: string,
  payload: Partial<{ name: string; durationSeconds: number; priceAmount: number; currency: string; isActive: boolean; sortOrder: number }>,
): Promise<PricingPlan> {
  return apiRequest(`${BASE}/api/settings/pricing/plans/${encodeURIComponent(planId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getPricingRule(): Promise<PricingRule | { rule: null }> {
  return apiRequest(`${BASE}/api/settings/pricing/rule`);
}

export async function updatePricingRule(payload: {
  roundingMode?: string;
  graceSeconds?: number;
  minimumBillableSeconds?: number;
  minimumPlanId?: string | null;
  overtimePolicy?: string;
  extraMinutePrice?: number | null;
}): Promise<PricingRule> {
  return apiRequest(`${BASE}/api/settings/pricing/rule`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Settings — staff ───────────────────────────────────────────────────────────

export async function getStaffMembers(
  visibility: 'active' | 'archived' | 'all' = 'active',
  init?: RequestInit,
): Promise<{ items: StaffMember[] }> {
  const qs = visibility !== 'active' ? `?visibility=${visibility}` : '';
  return apiRequest(`${BASE}/api/settings/staff${qs}`, init);
}

export async function archiveStaffMember(id: string, reason?: string): Promise<StaffMember> {
  return apiRequest(`${BASE}/api/settings/staff/${encodeURIComponent(id)}/archive`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export async function restoreStaffMember(
  id: string,
  opts?: { reason?: string; reactivateLinkedUser?: boolean },
): Promise<StaffMember> {
  return apiRequest(`${BASE}/api/settings/staff/${encodeURIComponent(id)}/restore`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts ?? {}),
  });
}

export async function hardDeleteStaffMember(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${BASE}/api/settings/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function createStaffMember(payload: {
  name: string;
  phone?: string;
  notes?: string;
}): Promise<StaffMember> {
  return apiRequest(`${BASE}/api/settings/staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateStaffMember(
  staffMemberId: string,
  payload: Partial<{ name: string; phone: string | null; isActive: boolean; notes: string | null }>,
): Promise<StaffMember> {
  return apiRequest(`${BASE}/api/settings/staff/${encodeURIComponent(staffMemberId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Settings — users & access ───────────────────────────────────────────────────

export async function getSettingsUsers(): Promise<{ items: SettingsUser[] }> {
  return apiRequest(`${BASE}/api/settings/users`);
}

export async function createSettingsUser(payload: {
  name: string;
  email: string;
  password: string;
  role: SettingsUserRole;
  staffMemberId?: string | null;
  isActive?: boolean;
}): Promise<SettingsUser> {
  return apiRequest(`${BASE}/api/settings/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateSettingsUser(
  userId: string,
  payload: Partial<{
    name: string;
    email: string;
    role: SettingsUserRole;
    staffMemberId: string | null;
    isActive: boolean;
  }>,
): Promise<SettingsUser> {
  return apiRequest(`${BASE}/api/settings/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function resetSettingsUserPassword(
  userId: string,
  password: string,
): Promise<{ ok: boolean }> {
  return apiRequest(`${BASE}/api/settings/users/${encodeURIComponent(userId)}/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

export async function disableSettingsUser(userId: string): Promise<SettingsUser> {
  return apiRequest(`${BASE}/api/settings/users/${encodeURIComponent(userId)}/disable`, {
    method: 'PATCH',
  });
}

// ── Settings — system ──────────────────────────────────────────────────────────

export async function getSystemSettings(): Promise<SystemSettings> {
  return apiRequest(`${BASE}/api/settings/system`);
}

// ── Settings — prime & bonus ───────────────────────────────────────────────────

export async function getPrimeSettingsSummary(): Promise<PrimeSettingsSummary> {
  return apiRequest(`${BASE}/api/settings/prime/summary`);
}

export async function getShiftTypes(visibility: 'active' | 'archived' | 'all' = 'active'): Promise<{ items: ShiftTypeSetting[] }> {
  const qs = visibility !== 'active' ? `?visibility=${visibility}` : '';
  return apiRequest(`${BASE}/api/settings/prime/shift-types${qs}`);
}

export async function createShiftType(payload: {
  name: string;
  label?: string;
  startTime: string;
  endTime: string;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<ShiftTypeSetting> {
  return apiRequest(`${BASE}/api/settings/prime/shift-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateShiftType(
  id: string,
  payload: Partial<{ label: string; startTime: string; endTime: string; isActive: boolean; sortOrder: number }>,
): Promise<ShiftTypeSetting> {
  return apiRequest(`${BASE}/api/settings/prime/shift-types/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function archiveShiftType(id: string, reason?: string): Promise<ShiftTypeSetting> {
  return apiRequest(`${BASE}/api/settings/prime/shift-types/${encodeURIComponent(id)}/archive`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export async function restoreShiftType(id: string, reason?: string): Promise<ShiftTypeSetting> {
  return apiRequest(`${BASE}/api/settings/prime/shift-types/${encodeURIComponent(id)}/restore`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export async function hardDeleteShiftType(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${BASE}/api/settings/prime/shift-types/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function getCommissionRules(): Promise<{ items: CommissionRuleSetting[] }> {
  return apiRequest(`${BASE}/api/settings/prime/commission-rules`);
}

export async function createCommissionRule(payload: {
  pricingPlanId: string;
  type: CommissionType;
  value: number;
  isActive?: boolean;
}): Promise<CommissionRuleSetting> {
  return apiRequest(`${BASE}/api/settings/prime/commission-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateCommissionRule(
  id: string,
  payload: Partial<{ type: CommissionType; value: number; isActive: boolean }>,
): Promise<CommissionRuleSetting> {
  return apiRequest(
    `${BASE}/api/settings/prime/commission-rules/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function getTargetBonusRules(): Promise<{ items: TargetBonusRuleSetting[] }> {
  return apiRequest(`${BASE}/api/settings/prime/target-bonus-rules`);
}

export async function createTargetBonusRule(payload: {
  shiftTypeId: string;
  targetAmount: number;
  bonusAmount: number;
  isActive?: boolean;
}): Promise<TargetBonusRuleSetting> {
  return apiRequest(`${BASE}/api/settings/prime/target-bonus-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateTargetBonusRule(
  id: string,
  payload: Partial<{ targetAmount: number; bonusAmount: number; isActive: boolean }>,
): Promise<TargetBonusRuleSetting> {
  return apiRequest(
    `${BASE}/api/settings/prime/target-bonus-rules/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

// ── Settings — shift planning ──────────────────────────────────────────────────
// Note: getShiftTypes / createShiftType / updateShiftType already exist above and
// use /api/settings/prime/shift-types — same backend service, same data.

export async function getShiftSchedule(params?: {
  staffMemberId?: string;
  visibility?: 'active' | 'archived' | 'all';
}): Promise<{ days: WeeklyScheduleDay[] }> {
  const qs = new URLSearchParams();
  if (params?.staffMemberId) qs.set('staffMemberId', params.staffMemberId);
  if (params?.visibility && params.visibility !== 'active') qs.set('visibility', params.visibility);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiRequest(`${BASE}/api/settings/shifts/schedule${suffix}`);
}

export async function createShiftSchedule(payload: {
  staffMemberId: string;
  shiftTypeId?: string | null;
  dayOfWeek: number;
  isOff?: boolean;
  notes?: string | null;
}): Promise<StaffScheduleItem> {
  return apiRequest(`${BASE}/api/settings/shifts/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateShiftSchedule(
  id: string,
  payload: Partial<{
    shiftTypeId: string | null;
    isOff: boolean;
    isActive: boolean;
    notes: string | null;
  }>,
): Promise<StaffScheduleItem> {
  return apiRequest(
    `${BASE}/api/settings/shifts/schedule/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function archiveShiftSchedule(id: string, reason?: string): Promise<StaffScheduleItem> {
  return apiRequest(`${BASE}/api/settings/shifts/schedule/${encodeURIComponent(id)}/archive`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export async function restoreShiftSchedule(id: string, reason?: string): Promise<StaffScheduleItem> {
  return apiRequest(`${BASE}/api/settings/shifts/schedule/${encodeURIComponent(id)}/restore`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export async function deleteShiftSchedule(id: string, hard = false): Promise<{ ok: boolean }> {
  const suffix = hard ? '?hard=true' : '';
  return apiRequest(
    `${BASE}/api/settings/shifts/schedule/${encodeURIComponent(id)}${suffix}`,
    { method: 'DELETE' },
  );
}

export async function getTodayShiftSuggestions(): Promise<{
  dayOfWeek: number;
  label: string;
  autoShiftEnabled: boolean;
  suggestions: TodayShiftSuggestion[];
}> {
  return apiRequest(`${BASE}/api/settings/shifts/today-suggestions`);
}

// ── Shifts — automation & manual control ───────────────────────────────────────

export async function getShiftAutomationStatus(): Promise<ShiftAutomationStatus> {
  return apiRequest(`${BASE}/api/shifts/automation/status`);
}

export async function runShiftAutomationCheck(): Promise<AutoShiftCheckResult & { ok: boolean }> {
  return apiRequest(`${BASE}/api/shifts/automation/check`, { method: 'POST' });
}

export async function getOpenShift(): Promise<{ shift: OpenShift | null }> {
  return apiRequest(`${BASE}/api/shifts/open`);
}

export async function openShiftManual(staffMemberId: string, shiftTypeId?: string): Promise<{ shift: OpenShift }> {
  return apiRequest(`${BASE}/api/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffMemberId, ...(shiftTypeId ? { shiftTypeId } : {}) }),
  });
}

export async function closeShift(shiftId: string, declaredCash?: number): Promise<{ shift: OpenShift }> {
  return apiRequest(`${BASE}/api/shifts/${encodeURIComponent(shiftId)}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(declaredCash != null ? { declaredCash } : {}),
  });
}

export async function deleteShift(shiftId: string): Promise<void> {
  await apiRequest(`${BASE}/api/shifts/${encodeURIComponent(shiftId)}`, {
    method: 'DELETE',
  });
}

// ── Dashboard — revenue stats ──────────────────────────────────────────────────

export async function getRevenueStats(period: 'day' | 'week' | 'month' | 'year'): Promise<RevenueStats> {
  return apiRequest<RevenueStats>(`${BASE}/api/dashboard/revenue-stats?period=${period}`);
}

// ── Dashboard — home (filterable analytics) ────────────────────────────────────

export async function getHomeDashboard(
  filters: Partial<HomeDashboardFilters>,
  signal?: AbortSignal,
): Promise<HomeDashboardResponse> {
  const qs = new URLSearchParams();
  if (filters.preset)        qs.set('preset',        filters.preset);
  if (filters.from)          qs.set('from',           filters.from);
  if (filters.to)            qs.set('to',             filters.to);
  if (filters.period)        qs.set('period',         filters.period);
  if (filters.periodStart)   qs.set('periodStart',    filters.periodStart);
  if (filters.periodEnd)     qs.set('periodEnd',      filters.periodEnd);
  if (filters.chair)         qs.set('chair',          filters.chair);
  if (filters.staffMemberId) qs.set('staffMemberId',  filters.staffMemberId);
  if (filters.shiftTypeId)   qs.set('shiftTypeId',    filters.shiftTypeId);
  // Shift filter only for Aujourd'hui / Hier — never send stale shiftId for week/month/year/custom
  const allowShift = filters.preset === 'today' || filters.preset === 'yesterday';
  if (allowShift && filters.shiftId) qs.set('shiftId', filters.shiftId);
  if (filters.status)        qs.set('status',         filters.status);
  if (filters.chartPeriod)   qs.set('chartPeriod',    filters.chartPeriod);
  return apiRequest<HomeDashboardResponse>(`${BASE}/api/dashboard/home?${qs.toString()}`, { signal });
}

// ── Sessions ───────────────────────────────────────────────────────────────────

export async function getSession(sessionId: string): Promise<SessionDetail> {
  return apiRequest<SessionDetail>(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}`);
}

export async function correctSession(
  sessionId: string,
  payload: SessionCorrectionPayload,
): Promise<{ ok: boolean; session: SessionDetail }> {
  return apiRequest<{ ok: boolean; session: SessionDetail }>(
    `${BASE}/api/sessions/${encodeURIComponent(sessionId)}/correction`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteSession(
  sessionId: string,
  reason?: string,
): Promise<{ ok: boolean; mode: 'archived' | 'deleted'; sessionId: string }> {
  return apiRequest<{ ok: boolean; mode: 'archived' | 'deleted'; sessionId: string }>(
    `${BASE}/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
}

// ── Session settings ───────────────────────────────────────────────────────────

export async function getSessionSettings(): Promise<SessionSettings> {
  return apiRequest<SessionSettings>(`${BASE}/api/settings/session`);
}

export async function updateSessionSettings(
  payload: Partial<Omit<SessionSettings, 'minimumPlan'>>,
): Promise<SessionSettings> {
  return apiRequest<SessionSettings>(`${BASE}/api/settings/session`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Chair sessions (existing, kept below) ─────────────────────────────────────

export async function getChairSessions(
  chairIdOrName: string,
  params: {
    period?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    status?: string;
  } = {},
): Promise<ChairSessionsResponse> {
  const qs = new URLSearchParams();
  if (params.period) qs.set('period', params.period);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.status) qs.set('status', params.status);
  const url = `${BASE}/api/chairs/${encodeURIComponent(chairIdOrName)}/sessions?${qs}`;
  const res = await fetch(url, { cache: 'no-store', credentials: 'include', headers: authHeaders(), signal: AbortSignal.timeout(6000) });
  if (res.status === 404) throw new Error('CHAIR_NOT_FOUND');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ChairSessionsResponse>;
}

// ── Maintenance (OWNER) ────────────────────────────────────────────────────────

export async function getBackupInstructions(): Promise<{
  pgDump: string;
  neon: string;
  note: string;
  recommendedBefore: string[];
}> {
  return apiRequest(`${BASE}/api/settings/maintenance/backup-instructions`);
}

export async function bulkArchiveInactiveStaff(
  confirmation: string,
  reason?: string,
): Promise<{ archived: number; candidateCount: number }> {
  return apiRequest(`${BASE}/api/settings/maintenance/bulk-archive-inactive-staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation, reason }),
  });
}

export async function bulkArchiveOrphanSchedules(
  confirmation: string,
  reason?: string,
): Promise<{ archived: number; candidateCount: number }> {
  return apiRequest(`${BASE}/api/settings/maintenance/bulk-archive-orphan-schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation, reason }),
  });
}

// ── Assistant (read-only) ──────────────────────────────────────────────────────

export async function getAssistantMe(): Promise<AssistantMeResponse> {
  return apiRequest(`${BASE}/api/assistant/me`);
}

export async function getAssistantToday(params?: {
  date?: string;
  shiftId?: string;
  staffMemberId?: string;
}): Promise<AssistantDashboardResponse> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.shiftId) qs.set('shiftId', params.shiftId);
  if (params?.staffMemberId) qs.set('staffMemberId', params.staffMemberId);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest(`${BASE}/api/assistant/today${suffix}`);
}

export async function getAssistantSessions(params?: {
  date?: string;
  shiftId?: string;
  staffMemberId?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<AssistantSessionsListResponse> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.shiftId) qs.set('shiftId', params.shiftId);
  if (params?.staffMemberId) qs.set('staffMemberId', params.staffMemberId);
  if (params?.status) qs.set('status', params.status);
  if (params?.page !== undefined) qs.set('page', String(params.page));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  return apiRequest(`${BASE}/api/assistant/sessions?${qs}`);
}

// ── Session plan change ────────────────────────────────────────────────────────

export async function changeSessionPlan(
  sessionId: string,
  payload: { requestedPlanId: string; reason?: string },
): Promise<SessionPlanChangeResult> {
  return apiRequest(
    `${BASE}/api/sessions/${encodeURIComponent(sessionId)}/plan`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function createSessionPlanChangeRequest(
  sessionId: string,
  payload: {
    requestedPlanId?: string;
    requestedPaidAmount?: number;
    reason: string;
  },
): Promise<{ ok: boolean; request: SessionPlanChangeRequest }> {
  return apiRequest(
    `${BASE}/api/sessions/${encodeURIComponent(sessionId)}/plan-change-requests`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function listSessionPlanChangeRequests(params?: {
  status?: SessionPlanChangeRequestStatus;
  sessionId?: string;
  limit?: number;
}): Promise<{ ok: boolean; requests: SessionPlanChangeRequest[] }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.sessionId) qs.set('sessionId', params.sessionId);
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest(`${BASE}/api/session-plan-change-requests${suffix}`);
}

export async function getSessionPlanChangeRequest(
  requestId: string,
): Promise<{ ok: boolean; request: SessionPlanChangeRequest }> {
  return apiRequest(
    `${BASE}/api/session-plan-change-requests/${encodeURIComponent(requestId)}`,
  );
}

export async function approveSessionPlanChangeRequest(
  requestId: string,
  payload?: { reviewNote?: string },
): Promise<SessionPlanChangeResult> {
  return apiRequest(
    `${BASE}/api/session-plan-change-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    },
  );
}

export async function rejectSessionPlanChangeRequest(
  requestId: string,
  payload?: { reviewNote?: string },
): Promise<{ ok: boolean; request: SessionPlanChangeRequest }> {
  return apiRequest(
    `${BASE}/api/session-plan-change-requests/${encodeURIComponent(requestId)}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    },
  );
}

export async function getAssistantPricingPlans(): Promise<{
  ok: boolean;
  items: Array<{
    id: string;
    name: string;
    durationSeconds: number;
    priceAmount: number;
    currency: string;
    sortOrder: number;
  }>;
}> {
  return apiRequest(`${BASE}/api/assistant/pricing-plans`);
}

export async function getAssistantPlanChangeRequests(params?: {
  status?: SessionPlanChangeRequestStatus;
}): Promise<{ ok: boolean; requests: SessionPlanChangeRequest[] }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest(`${BASE}/api/assistant/plan-change-requests${suffix}`);
}
