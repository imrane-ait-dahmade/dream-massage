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
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
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
  summary: AssistantSummary;
  sessions: AssistantSessionRow[];
  alerts: AssistantAlert[];
}

export interface AssistantSessionsListResponse {
  date: string;
  staffMember: AssistantStaffInfo;
  sessions: AssistantSessionRow[];
  page: number;
  limit: number;
  total: number;
}
