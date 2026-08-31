/**
 * Async cash access checks (Prisma). Keep separate from pure rules for unit tests.
 */
import { prisma } from '../../prisma';
import type { AuthUser } from '../auth/auth.service';
import {
  authenticatedStaffMemberId,
  canStaffAccessCashAccount,
  httpForbidden,
  isOwnerOrAdminRole,
  PHYSICAL_CASH_CODES,
} from './cash-access';

export async function findAssignedCashAccountForStaff(
  staffMemberId: string,
): Promise<{ id: string; staffMemberId: string | null } | null> {
  return prisma.cashAccount.findFirst({
    where: {
      staffMemberId,
      isActive: true,
      code: { in: [...PHYSICAL_CASH_CODES] },
    },
    select: { id: true, staffMemberId: true },
  });
}

/**
 * Throws 403 if the user cannot access this till.
 * OWNER/ADMIN always allowed. ASSISTANT only when currently assigned.
 */
export async function assertUserCanAccessCashAccount(
  user: AuthUser,
  cashAccountId: string,
): Promise<void> {
  if (isOwnerOrAdminRole(user)) return;

  const staffId = authenticatedStaffMemberId(user);
  if (!staffId) {
    throw httpForbidden();
  }

  const account = await prisma.cashAccount.findUnique({
    where: { id: cashAccountId },
    select: { staffMemberId: true },
  });
  if (!account) {
    throw Object.assign(new Error('Caisse introuvable'), { status: 404 });
  }

  if (!canStaffAccessCashAccount(staffId, account.staffMemberId)) {
    throw httpForbidden();
  }
}

/** Resolve till id an ASSISTANT may read (null = no assigned till). */
export async function resolveStaffReadableCashAccountId(
  user: AuthUser,
): Promise<string | null> {
  const staffId = authenticatedStaffMemberId(user);
  if (!staffId) return null;
  const account = await findAssignedCashAccountForStaff(staffId);
  return account?.id ?? null;
}
