export type ChairStatus =
  | 'IDLE'
  | 'MAYBE_ACTIVE'
  | 'ACTIVE'
  | 'MAYBE_FINISHED'
  | 'OFFLINE'
  | 'ERROR'
  | 'MAINTENANCE';

export interface ChairCardData {
  id: string;
  name: string;
  displayName: string | null;
  status: ChairStatus;
  powerWatts: number;
  isOnline: boolean;
  sessionStartedAt: string | null;
  elapsedSeconds: number;
  warning: string | null;
}

export interface TodayStats {
  expectedRevenue: number;
  sessionsCount: number;
  activeChairs: number;
  offlineChairs: number;
}

export interface OpenShift {
  id: string;
  staffMemberName: string;
  startedAt: string;
}

export interface DashboardState {
  serverTime: string;
  connection: 'mock' | 'live';
  todayStats: TodayStats;
  openShift: OpenShift | null;
  chairs: ChairCardData[];
}

// ── Chair detail ───────────────────────────────────────────────────────────────

export interface ChairCurrentSession {
  id: string;
  startedAt: string;
  elapsedSeconds: number;
  startedAtLabel: string;
}

export interface ChairDetailStats {
  sessionsCount: number;
  completedSessionsCount: number;
  activeSessionsCount: number;
  expectedRevenue: number;
  correctedRevenue: number;
  finalRevenue: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
}

export interface ChairRecentSession {
  id: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  expectedAmount: number | null;
  correctedAmount: number | null;
  finalAmount: number | null;
  billingStatus: string;
  matchedPlanName: string | null;
  shiftId: string | null;
  anomalyType: string | null;
}

export interface ChairEvent {
  id: string;
  eventType: string;
  powerWatts: number | null;
  message: string | null;
  createdAt: string;
}

export interface ChairOverview {
  chair: {
    id: string;
    name: string;
    displayName: string | null;
    status: ChairStatus;
    powerWatts: number;
    isOnline: boolean;
    relayIsOn: boolean | null;
    lastSyncedAt: string | null;
    currentSession: ChairCurrentSession | null;
  };
  today: ChairDetailStats;
  month: ChairDetailStats;
  recentSessions: ChairRecentSession[];
  events: ChairEvent[];
}

export interface ChairSessionsResponse {
  items: ChairRecentSession[];
  total: number;
  page: number;
  limit: number;
}

// ── Settings ───────────────────────────────────────────────────────────────────

export interface ChairDetectionConfig {
  id: string;
  startThresholdWatts: number;
  stopThresholdWatts: number;
  startConfirmSeconds: number;
  stopConfirmSeconds: number;
  activationDelaySeconds: number;
  baselinePowerWatts: number | null;
  version: number;
}

export interface SettingsChair {
  id: string;
  name: string;
  displayName: string | null;
  shellyDeviceIdMasked: string | null;
  shellyChannel: number | null;
  status: ChairStatus;
  isEnabled: boolean;
  isOnline: boolean;
  currentPowerWatts: number;
  lastSyncedAt: string | null;
  detectionConfig: ChairDetectionConfig | null;
}

export interface PricingPlan {
  id: string;
  name: string;
  durationSeconds: number;
  priceAmount: number;
  currency: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface PricingRule {
  id: string;
  roundingMode: 'NEAREST_PLAN' | 'NEXT_PLAN' | 'EXACT_MINUTES';
  graceSeconds: number;
  minimumBillableSeconds: number;
  minimumPlanId: string | null;
  overtimePolicy: 'NEXT_PLAN' | 'EXTRA_MINUTE' | 'ANOMALY';
  extraMinutePrice: number | null;
  isActive: boolean;
  minimumPlan: { id: string; name: string; durationSeconds: number; priceAmount: number } | null;
  createdAt: string;
}

export interface StaffMember {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

export interface ShellyDevice {
  chairName: string;
  deviceIdConfigured: boolean;
  deviceIdMasked: string | null;
}

export interface SystemSettings {
  appTimezone: string;
  syncIntervalMs: number;
  simulationEnabled: boolean;
  shelly: {
    serverUrlConfigured: boolean;
    authKeyConfigured: boolean;
    devices: ShellyDevice[];
  };
  database: { connected: boolean };
}

export interface RevenueStats {
  period: string;
  labels: string[];
  revenue: number[];
  sessions: number[];
  totalRevenue: number;
  totalSessions: number;
}

// ── Prime & Bonus ──────────────────────────────────────────────────────────────

export type CommissionType = 'PERCENTAGE' | 'FIXED_AMOUNT';

export interface ShiftTypeSetting {
  id: string;
  name: string;
  label: string | null;
  startTime: string;
  endTime: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface CommissionRuleSetting {
  id: string;
  pricingPlanId: string;
  pricingPlanName: string;
  pricingPlanPrice: number;
  type: CommissionType;
  value: number;
  isActive: boolean;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
}

export interface TargetBonusRuleSetting {
  id: string;
  shiftTypeId: string;
  shiftTypeLabel: string;
  targetAmount: number;
  bonusAmount: number;
  isActive: boolean;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
}

export interface PrimeSettingsSummary {
  shiftTypes: ShiftTypeSetting[];
  pricingPlans: PricingPlan[];
  commissionRules: CommissionRuleSetting[];
  targetBonusRules: TargetBonusRuleSetting[];
}

// ── Shift Planning ─────────────────────────────────────────────────────────────

export interface StaffScheduleItem {
  id: string;
  staffMemberId: string;
  staffMemberName: string;
  shiftTypeId: string | null;
  shiftTypeLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  isOff: boolean;
  isActive: boolean;
  notes: string | null;
}

export interface WeeklyScheduleDay {
  dayOfWeek: number;
  label: string;
  items: StaffScheduleItem[];
}

export interface TodayShiftSuggestion {
  staffMemberId: string;
  staffMemberName: string;
  shiftTypeId: string | null;
  shiftTypeLabel: string | null;
  startTime: string | null;
  endTime: string | null;
}

// ── Home Dashboard ─────────────────────────────────────────────────────────────

export interface HomeDashboardFilters {
  preset:        string;   // today | yesterday | week | month | year | custom
  from:          string;
  to:            string;
  period:       'all' | 'matin' | 'soir' | 'journee' | 'custom';
  periodStart?:  string;
  periodEnd?:    string;
  chair:         string;
  staffMemberId: string;
  shiftTypeId:   string;
  shiftId:       string;
  status:        string;   // all | ACTIVE | COMPLETED | PENDING | CORRECTED | ANOMALY
  chartPeriod:  'day' | 'week' | 'month' | 'year';
}

export interface DashboardFilterOptions {
  chairs:       Array<{ id: string; name: string; displayName: string | null }>;
  staffMembers: Array<{ id: string; name: string }>;
  shiftTypes:   Array<{ id: string; label: string }>;
  shifts:       Array<{
    id: string; label: string; staffMemberName: string | null;
    shiftTypeLabel: string | null; status: string;
  }>;
}

export interface DashboardCurrentShift {
  id:              string;
  staffMemberName: string | null;
  shiftTypeLabel:  string | null;
  startedAt:       string;
  scheduledEndAt:  string | null;
  grossRevenue:    number;
  totalPrime:      number;
  netRevenue:      number;
}

export interface HomeSummary {
  grossRevenue:           number;
  netRevenue:             number;
  sessionsCount:          number;
  completedSessionsCount: number;
  activeSessionsCount:    number;
  pendingSessionsCount:   number;
  correctedSessionsCount: number;
  outOfRuleSessionsCount: number;
  activeChairs:           number;
  offlineChairs:          number;
  totalPrime:             number;
}

export interface HomeLiveChair {
  id: string;
  name: string;
  displayName: string | null;
  status: ChairStatus;
  powerWatts: number;
  isOnline: boolean;
  warning: string | null;
}

export interface HomeTotalsByChair {
  chairId: string;
  chairName: string;
  displayName: string | null;
  sessionsCount: number;
  completedSessionsCount: number;
  activeSessionsCount: number;
  outOfRuleSessionsCount: number;
  revenue: number;
  durationTotalSeconds: number;
  plans: Array<{ label: string; count: number; revenue: number }>;
}

export interface HomePrimeRevenue {
  grossRevenue:                    number;
  planCommission:                  number;
  targetBonus:                     number;
  manualBonus:                     number;
  totalPrime:                      number;
  netRevenue:                      number;
  isEstimated:                     boolean;
  eligibleCommissionSessionsCount: number;
  excludedCommissionSessionsCount: number;
  pendingSessionsCount:            number;
}

export interface HomeRevenueChart {
  period: string;
  labels: string[];
  revenue: number[];
  sessions: number[];
  totalRevenue: number;
  totalSessions: number;
}

export interface HomeRecentSession {
  id:               string;
  chairName:        string;
  staffMemberName:  string | null;
  shiftTypeLabel:   string | null;
  startedAt:        string;
  endedAt:          string | null;
  durationSeconds:  number | null;
  status:           string;
  matchedPlanName:  string | null;
  amount:           number;   // finalAmount for backward compat
  finalAmount:      number;
  expectedAmount:   number | null;
  correctedAmount:  number | null;
  correctionReason: string | null;
  anomalyType:      string | null;
  billingStatus:    string;
}

// ── Session detail (from GET /api/sessions/:id) ────────────────────────────────

export interface SessionDetail {
  id: string;
  chairId: string;
  chairName: string;
  chairDisplayName: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  matchedPlanName: string | null;
  matchedPlanId: string | null;
  expectedAmount: number | null;
  correctedAmount: number | null;
  finalAmount: number;
  billingStatus: string;
  anomalyType: string | null;
  correctionReason: string | null;
  correctedAt: string | null;
  notes: string | null;
}

// ── Session settings (from GET /api/settings/session) ─────────────────────────

export interface SessionSettings {
  minimumBillableSeconds: number;
  graceSeconds: number;
  roundingMode: 'NEAREST_PLAN' | 'NEXT_PLAN' | 'EXACT_MINUTES';
  overtimePolicy: 'NEXT_PLAN' | 'EXTRA_MINUTE' | 'ANOMALY';
  extraMinutePrice: number | null;
  minimumPlanId: string | null;
  minimumPlan: { id: string; name: string; durationSeconds: number; priceAmount: number } | null;
  allowManualSessionCorrection: boolean;
  correctionReasonRequired: boolean;
}

export interface SessionCorrectionPayload {
  correctedAmount?: number;
  correctionReason?: string;
  notes?: string;
  clearCorrection?: boolean;
}

export interface HomeDashboardResponse {
  filters:        HomeDashboardFilters;
  filterOptions:  DashboardFilterOptions;
  currentShift:   DashboardCurrentShift | null;
  summary:        HomeSummary;
  liveChairs:     HomeLiveChair[];
  totalsByChair:  HomeTotalsByChair[];
  primeRevenue:   HomePrimeRevenue;
  revenueChart:   HomeRevenueChart;
  recentSessions: HomeRecentSession[];
}
