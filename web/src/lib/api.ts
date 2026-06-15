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
} from './types';

const BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:4001';

if (process.env.NODE_ENV === 'development') {
  console.log('[api] NEXT_PUBLIC_API_URL =', process.env.NEXT_PUBLIC_API_URL ?? '(not set — using fallback)');
  console.log('[api] Base URL =', BASE);
}

export async function getDashboardState(): Promise<DashboardState> {
  if (process.env.NODE_ENV === 'development') {
    console.log('[api] GET', `${BASE}/api/dashboard/state`);
  }
  const res = await fetch(`${BASE}/api/dashboard/state`, {
    cache: 'no-store',
    credentials: 'include',
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
    { cache: 'no-store', credentials: 'include', signal: AbortSignal.timeout(6000) },
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

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN';
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json()) as { ok: boolean; user?: AuthUser; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.user!;
}

export async function getMe(): Promise<AuthUser> {
  return apiRequest<{ ok: boolean; user: AuthUser }>(`${BASE}/api/auth/me`).then((r) => r.user);
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    signal: AbortSignal.timeout(8000),
  });
}

// ── Settings helpers ───────────────────────────────────────────────────────────

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    signal: AbortSignal.timeout(8000),
    ...init,
  });
  if (res.status === 401) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.replace('/login');
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
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

export async function getStaffMembers(): Promise<{ items: StaffMember[] }> {
  return apiRequest(`${BASE}/api/settings/staff`);
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

// ── Settings — system ──────────────────────────────────────────────────────────

export async function getSystemSettings(): Promise<SystemSettings> {
  return apiRequest(`${BASE}/api/settings/system`);
}

// ── Settings — prime & bonus ───────────────────────────────────────────────────

export async function getPrimeSettingsSummary(): Promise<PrimeSettingsSummary> {
  return apiRequest(`${BASE}/api/settings/prime/summary`);
}

export async function getShiftTypes(): Promise<{ items: ShiftTypeSetting[] }> {
  return apiRequest(`${BASE}/api/settings/prime/shift-types`);
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
}): Promise<{ days: WeeklyScheduleDay[] }> {
  const qs = new URLSearchParams();
  if (params?.staffMemberId) qs.set('staffMemberId', params.staffMemberId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiRequest(`${BASE}/api/settings/shifts/schedule${suffix}`);
}

export async function createShiftSchedule(payload: {
  staffMemberId: string;
  shiftTypeId?: string | null;
  dayOfWeek: number;
  startTime?: string | null;
  endTime?: string | null;
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
    startTime: string | null;
    endTime: string | null;
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

export async function deleteShiftSchedule(id: string): Promise<{ ok: boolean }> {
  return apiRequest(
    `${BASE}/api/settings/shifts/schedule/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export async function getTodayShiftSuggestions(): Promise<{
  dayOfWeek: number;
  label: string;
  suggestions: TodayShiftSuggestion[];
}> {
  return apiRequest(`${BASE}/api/settings/shifts/today-suggestions`);
}

export async function openShift(payload: {
  staffMemberId: string;
  shiftTypeId?: string;
}): Promise<{ shift: unknown }> {
  return apiRequest(`${BASE}/api/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Dashboard — revenue stats ──────────────────────────────────────────────────

export async function getRevenueStats(period: 'day' | 'week' | 'month' | 'year'): Promise<RevenueStats> {
  return apiRequest<RevenueStats>(`${BASE}/api/dashboard/revenue-stats?period=${period}`);
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
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
  if (res.status === 404) throw new Error('CHAIR_NOT_FOUND');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ChairSessionsResponse>;
}
