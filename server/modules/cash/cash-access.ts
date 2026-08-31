/**
 * Cash till access rules — staff sees only their currently assigned physical till.
 * Pure helpers are testable without DB.
 */
import type { AuthUser } from '../auth/auth.service';

const PHYSICAL_CASH_CODES = ['CASH_1', 'CASH_2'] as const;

export function httpForbidden(message = 'Accès refusé à cette caisse.'): Error & { status: number } {
  return Object.assign(new Error(message), { status: 403 });
}

export function isOwnerOrAdminRole(user: AuthUser | undefined): boolean {
  return user?.role === 'OWNER' || user?.role === 'ADMIN';
}

export function isAssistantRole(user: AuthUser | undefined): boolean {
  return user?.role === 'ASSISTANT';
}

/** Staff may access a till only when currently assigned (CashAccount.staffMemberId). */
export function canStaffAccessCashAccount(
  authenticatedStaffMemberId: string | null | undefined,
  accountStaffMemberId: string | null,
): boolean {
  if (!authenticatedStaffMemberId?.trim() || !accountStaffMemberId) return false;
  return authenticatedStaffMemberId.trim() === accountStaffMemberId;
}

export function canUserAccessCashAccount(
  user: AuthUser,
  accountStaffMemberId: string | null,
): boolean {
  if (isOwnerOrAdminRole(user)) return true;
  if (!isAssistantRole(user)) return false;
  return canStaffAccessCashAccount(user.staffMemberId, accountStaffMemberId);
}

/** StaffMember id linked to the authenticated user (ASSISTANT only). Never trust client input. */
export function authenticatedStaffMemberId(user: AuthUser | undefined): string | null {
  if (!user || !isAssistantRole(user)) return null;
  return user.staffMemberId?.trim() || null;
}

export { PHYSICAL_CASH_CODES };
