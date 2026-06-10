import type {
  DashboardState,
  ChairOverview,
  ChairSessionsResponse,
  SettingsChair,
  PricingPlan,
  PricingRule,
  StaffMember,
  SystemSettings,
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
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<DashboardState>;
}

export async function getChairOverview(chairIdOrName: string): Promise<ChairOverview> {
  const res = await fetch(
    `${BASE}/api/chairs/${encodeURIComponent(chairIdOrName)}/overview`,
    { cache: 'no-store', signal: AbortSignal.timeout(6000) },
  );
  if (res.status === 404) throw new Error('CHAIR_NOT_FOUND');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ChairOverview>;
}

// ── Settings helpers ───────────────────────────────────────────────────────────

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000), ...init });
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
