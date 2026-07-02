import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';
import type { UserCreateInput, UserUpdateInput, UserPasswordResetInput } from './user-settings.types';

// ── Mapping ────────────────────────────────────────────────────────────────────
// passwordHash never leaves this module.

type UserWithStaff = Prisma.UserGetPayload<{
  include: { staffMember: { select: { id: true; name: true; isActive: true } } };
}>;

function mapUser(u: UserWithStaff) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    staffMemberId: u.staffMemberId,
    staffMember: u.staffMember
      ? { id: u.staffMember.id, name: u.staffMember.name, isActive: u.staffMember.isActive }
      : null,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

const STAFF_INCLUDE = {
  staffMember: { select: { id: true, name: true, isActive: true } },
} as const;

function forbidden(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 });
}

function conflict(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 409 });
}

// ── Service ────────────────────────────────────────────────────────────────────

class UserSettingsService {
  private async audit(params: {
    entityId: string;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
  }, actingUserId?: string): Promise<void> {
    try {
      let resolvedUserId = actingUserId ?? null;
      if (!resolvedUserId) {
        const owner = await prisma.user.findFirst({
          where: { role: 'OWNER', isActive: true },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        resolvedUserId = owner?.id ?? null;
      }
      await prisma.settingsAuditLog.create({
        data: {
          userId: resolvedUserId,
          entityType: 'User',
          entityId: params.entityId,
          action: params.action,
          oldValue: params.oldValue != null ? (params.oldValue as Prisma.InputJsonValue) : undefined,
          newValue: params.newValue != null ? (params.newValue as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (err) {
      // Audit failure must never block the primary operation
      logger.warn('[user-settings] Audit log write failed:', String(err));
    }
  }

  /** Rejects if staffMemberId doesn't exist or points to an inactive StaffMember. */
  private async assertStaffMemberUsable(staffMemberId: string): Promise<void> {
    const staff = await prisma.staffMember.findUnique({
      where: { id: staffMemberId },
      select: { isActive: true },
    });
    if (!staff) throw forbidden('staffMemberId does not refer to an existing staff member');
    if (!staff.isActive) throw forbidden('staffMemberId refers to an inactive staff member');
  }

  /** Rejects if disabling/demoting `excludeUserId` would leave zero active OWNER/ADMIN. */
  private async assertNotLastActiveOwnerAdmin(excludeUserId: string): Promise<void> {
    const remaining = await prisma.user.count({
      where: { role: { in: ['OWNER', 'ADMIN'] }, isActive: true, id: { not: excludeUserId } },
    });
    if (remaining === 0) {
      throw conflict('Cannot disable or change the role of the last active OWNER/ADMIN');
    }
  }

  /** Translates known Prisma constraint violations into user-facing 409s. */
  private mapWriteError(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = ((err.meta?.target as string[] | string | undefined) ?? '').toString();
      if (target.includes('email')) return conflict('A user with this email already exists');
      if (target.includes('staff_member_id')) {
        return conflict('This staff member is already linked to another user account');
      }
      return conflict('Duplicate value');
    }
    return err;
  }

  // ── Read ─────────────────────────────────────────────────────────────────────

  async getUsers() {
    const users = await prisma.user.findMany({
      orderBy: { email: 'asc' },
      include: STAFF_INCLUDE,
    });
    return { items: users.map(mapUser) };
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  async createUser(input: UserCreateInput, actingUserId?: string) {
    const staffMemberId = input.role === 'ASSISTANT' ? input.staffMemberId! : null;
    if (input.role === 'ASSISTANT') {
      await this.assertStaffMemberUsable(staffMemberId!);
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const email = input.email.toLowerCase().trim();

    let user: UserWithStaff;
    try {
      user = await prisma.user.create({
        data: {
          name: input.name,
          email,
          passwordHash,
          role: input.role,
          staffMemberId,
          isActive: input.isActive,
        },
        include: STAFF_INCLUDE,
      });
    } catch (err) {
      throw this.mapWriteError(err);
    }

    await this.audit({
      entityId: user.id,
      action: 'CREATE',
      newValue: { email: user.email, role: user.role, staffMemberId: user.staffMemberId, isActive: user.isActive },
    }, actingUserId);

    return mapUser(user);
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  async updateUser(userId: string, input: UserUpdateInput, actingUserId?: string) {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) return null;

    const effectiveRole = input.role ?? existing.role;
    let effectiveStaffMemberId: string | null =
      input.staffMemberId !== undefined ? input.staffMemberId : existing.staffMemberId;

    if (effectiveRole === 'ASSISTANT') {
      if (!effectiveStaffMemberId) {
        throw forbidden('staffMemberId is required when role is ASSISTANT');
      }
      await this.assertStaffMemberUsable(effectiveStaffMemberId);
    } else {
      // OWNER/ADMIN must never carry a staffMemberId — enforced regardless of payload.
      effectiveStaffMemberId = null;
    }

    const effectiveIsActive = input.isActive ?? existing.isActive;
    const wasOwnerAdmin = existing.role === 'OWNER' || existing.role === 'ADMIN';
    const staysOwnerAdmin = effectiveRole === 'OWNER' || effectiveRole === 'ADMIN';
    if (wasOwnerAdmin && (!staysOwnerAdmin || !effectiveIsActive)) {
      await this.assertNotLastActiveOwnerAdmin(userId);
    }

    const oldValue = { email: existing.email, role: existing.role, staffMemberId: existing.staffMemberId, isActive: existing.isActive };

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email.toLowerCase().trim();
    if (input.role !== undefined) data.role = input.role;
    if (input.role !== undefined || input.staffMemberId !== undefined) {
      data.staffMember = effectiveStaffMemberId
        ? { connect: { id: effectiveStaffMemberId } }
        : { disconnect: true };
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;

    let updated: UserWithStaff;
    try {
      updated = await prisma.user.update({ where: { id: userId }, data, include: STAFF_INCLUDE });
    } catch (err) {
      throw this.mapWriteError(err);
    }

    await this.audit({
      entityId: userId,
      action: 'UPDATE',
      oldValue,
      newValue: { email: updated.email, role: updated.role, staffMemberId: updated.staffMemberId, isActive: updated.isActive },
    }, actingUserId);

    return mapUser(updated);
  }

  // ── Password reset ──────────────────────────────────────────────────────────

  async resetPassword(userId: string, input: UserPasswordResetInput, actingUserId?: string) {
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) return null;

    const passwordHash = await bcrypt.hash(input.password, 10);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Never log the password or its hash — action alone is enough for the audit trail.
    await this.audit({ entityId: userId, action: 'PASSWORD_RESET' }, actingUserId);

    return { ok: true };
  }

  // ── Disable (soft delete — isActive=false, row is never removed) ─────────────

  async disableUser(userId: string, actingUserId?: string) {
    const existing = await prisma.user.findUnique({ where: { id: userId }, include: STAFF_INCLUDE });
    if (!existing) return null;
    if (!existing.isActive) return mapUser(existing); // already disabled — idempotent no-op

    if (existing.role === 'OWNER' || existing.role === 'ADMIN') {
      await this.assertNotLastActiveOwnerAdmin(userId);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
      include: STAFF_INCLUDE,
    });

    await this.audit({
      entityId: userId,
      action: 'DISABLE',
      oldValue: { isActive: true },
      newValue: { isActive: false },
    }, actingUserId);

    return mapUser(updated);
  }
}

export const userSettingsService = new UserSettingsService();
