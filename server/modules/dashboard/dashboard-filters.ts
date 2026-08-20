/**
 * Shared dashboard filter composition for KPI / chart / table / export.
 * Date bounds come from date-range.ts — never re-implement them here.
 */
import type { Prisma } from '@prisma/client';
import { SESSION_OPERATIONAL_WHERE } from '../archive/archive-filters';
import { buildDateRangeFilter } from './date-range';

/** Shift filter is allowed only for single-day presets Aujourd'hui / Hier. */
export function canFilterByShift(preset: string | undefined | null): boolean {
  return preset === 'today' || preset === 'yesterday';
}

export interface DashboardFilterInput {
  preset: string;
  from: string;
  to: string;
  status?: string;
  staffMemberId?: string;
  shiftTypeId?: string;
  /** Ignored unless canFilterByShift(preset). */
  shiftId?: string;
  chairId?: string;
  tz?: string;
}

export interface NormalizedDashboardFilters {
  preset: string;
  from: string;
  to: string;
  status: string;
  staffMemberId: string;
  shiftTypeId: string;
  /** Always 'all' when shift filter is not allowed for the preset. */
  shiftId: string;
  allowShift: boolean;
  utcStart: Date;
  utcEnd: Date;
}

const VALID_STATUSES = ['all', 'ACTIVE', 'COMPLETED', 'PENDING', 'CORRECTED', 'ANOMALY'] as const;

/**
 * Normalize filter params: clear shiftId outside today/yesterday,
 * resolve semi-open date range via buildDateRangeFilter.
 */
export function normalizeDashboardFilters(input: DashboardFilterInput): NormalizedDashboardFilters {
  const allowShift = canFilterByShift(input.preset);
  const dateRange = buildDateRangeFilter(input.from, input.to, input.tz);
  const status = VALID_STATUSES.includes(input.status as (typeof VALID_STATUSES)[number])
    ? (input.status as string)
    : 'all';

  return {
    preset: input.preset,
    from: dateRange.from,
    to: dateRange.to,
    status,
    staffMemberId: input.staffMemberId && input.staffMemberId !== '' ? input.staffMemberId : 'all',
    shiftTypeId: input.shiftTypeId && input.shiftTypeId !== '' ? input.shiftTypeId : 'all',
    shiftId: allowShift && input.shiftId && input.shiftId !== '' ? input.shiftId : 'all',
    allowShift,
    utcStart: dateRange.gte,
    utcEnd: dateRange.lt,
  };
}

function statusWhere(status: string): Prisma.ChairSessionWhereInput {
  switch (status) {
    case 'ACTIVE':
      return { status: 'ACTIVE' };
    case 'COMPLETED':
      return { status: 'COMPLETED' };
    case 'PENDING':
      return { status: { not: 'CANCELLED' }, billingStatus: 'PENDING' };
    case 'CORRECTED':
      return {
        status: { not: 'CANCELLED' },
        OR: [{ billingStatus: 'CORRECTED' }, { correctedAmount: { not: null } }],
      };
    case 'ANOMALY':
      return { status: { not: 'CANCELLED' }, anomalyType: { not: null } };
    default:
      return { status: { not: 'CANCELLED' } };
  }
}

/**
 * Historical staff filter: ChairSession → Shift.staffMemberId
 * (staff frozen on the Shift row — not the "current" open shift).
 */
export function buildStaffShiftRelationFilter(
  staffMemberId: string,
  shiftTypeId: string,
): Prisma.ShiftWhereInput | undefined {
  if (staffMemberId === 'all' && shiftTypeId === 'all') return undefined;
  return {
    ...(staffMemberId !== 'all' ? { staffMemberId } : {}),
    ...(shiftTypeId !== 'all' ? { shiftTypeId } : {}),
  };
}

/**
 * Single session WHERE used by summary, chart, table, and (future) Excel export.
 */
export function buildDashboardSessionWhere(
  filters: NormalizedDashboardFilters,
  extras?: { chairId?: string },
): Prisma.ChairSessionWhereInput {
  const shiftRel = buildStaffShiftRelationFilter(filters.staffMemberId, filters.shiftTypeId);

  const where: Prisma.ChairSessionWhereInput = {
    ...SESSION_OPERATIONAL_WHERE,
    startedAt: { gte: filters.utcStart, lt: filters.utcEnd },
    ...statusWhere(filters.status),
    ...(extras?.chairId ? { chairId: extras.chairId } : {}),
  };

  // shiftId (today/yesterday only) AND optional historical staff/type on Shift — AND together.
  if (filters.shiftId !== 'all') {
    where.shiftId = filters.shiftId;
  }
  if (shiftRel) {
    where.shift = shiftRel;
  }

  return where;
}

/** Shift dropdown options for the same date window (+ optional fille). */
export function buildDashboardShiftsWhere(
  filters: NormalizedDashboardFilters,
): Prisma.ShiftWhereInput {
  return {
    startedAt: { gte: filters.utcStart, lt: filters.utcEnd },
    ...(filters.staffMemberId !== 'all' ? { staffMemberId: filters.staffMemberId } : {}),
    ...(filters.shiftTypeId !== 'all' ? { shiftTypeId: filters.shiftTypeId } : {}),
  };
}
