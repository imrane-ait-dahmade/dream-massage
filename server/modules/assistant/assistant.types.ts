export interface AssistantUserInfo {
  id: string;
  name: string;
  email: string;
  role: 'ASSISTANT';
}

export interface AssistantStaffInfo {
  id: string;
  name: string;
}

export interface AssistantMeResponse {
  user: AssistantUserInfo;
  staffMember: AssistantStaffInfo;
}

export interface AssistantCurrentShift {
  id: string;
  shiftTypeLabel: string | null;
  status: string;
  startedAt: string;
  scheduledEndAt: string | null;
}

export interface AssistantSummary {
  grossRevenue: number;
  planCommission: number;
  targetBonus: number;
  manualBonus: number;
  totalPrime: number;
  netRevenue: number;
  sessionsCount: number;
  completedSessionsCount: number;
  pendingSessionsCount: number;
  correctedSessionsCount: number;
  outOfRuleSessionsCount: number;
}

export interface AssistantSessionRow {
  id: string;
  chairName: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  matchedPlanId: string | null;
  matchedPlanName: string | null;
  expectedAmount: number;
  correctedAmount: number | null;
  finalAmount: number;
  billingStatus: string;
  anomalyType: string | null;
  correctionReason: string | null;
}

export interface AssistantAlert {
  type: string;
  message: string;
  sessionId?: string;
}

export interface AssistantDashboardResponse {
  date: string;
  staffMember: AssistantStaffInfo;
  currentShift: AssistantCurrentShift | null;
  /** Shop-wide active shift (may belong to another staff member). */
  shopOpenShift: AssistantShopOpenShift | null;
  selfStartShiftEnabled: boolean;
  availableShiftTypes: AssistantShiftTypeOption[];
  summary: AssistantSummary;
  sessions: AssistantSessionRow[];
  alerts: AssistantAlert[];
}

export interface AssistantShopOpenShift {
  id: string;
  staffMember: AssistantStaffInfo;
  shiftTypeLabel: string | null;
  status: string;
  startedAt: string;
  isOwn: boolean;
}

export interface AssistantShiftTypeOption {
  id: string;
  name: string;
  label: string | null;
  startTime: string;
  endTime: string;
}

export interface AssistantStartShiftResponse {
  ok: true;
  shift: {
    id: string;
    status: string;
    startedAt: string;
    businessDate: string | null;
    scheduledEndAt: string | null;
    staffMember: AssistantStaffInfo;
    shiftType: { id: string; label: string | null; name: string };
  };
}

export interface AssistantCloseShiftResponse {
  ok: true;
  shift: {
    id: string;
    status: string;
    endedAt: string | null;
  };
}

export interface AssistantSessionsListResponse {
  date: string;
  staffMember: AssistantStaffInfo;
  sessions: AssistantSessionRow[];
  page: number;
  limit: number;
  total: number;
}
