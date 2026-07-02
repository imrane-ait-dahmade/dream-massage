import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../../prisma';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export type UserRole = 'OWNER' | 'ADMIN' | 'ASSISTANT';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  staffMemberId: string | null;
}

export type LoginResult =
  | { status: 'ok'; token: string; user: AuthUser }
  | { status: 'invalid_credentials' }
  | { status: 'assistant_inactive' };

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  staffMemberId?: string | null;
  iat?: number;
  exp?: number;
}

const ASSISTANT_INACTIVE_MSG = 'Assistant account is not active';

export class AuthService {
  createJwt(user: AuthUser): string {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        staffMemberId: user.staffMemberId,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions,
    );
  }

  verifyToken(token: string): JwtPayload | null {
    try {
      return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    } catch {
      return null;
    }
  }

  /** Returns true when assistant user is linked to an active StaffMember. */
  async isAssistantAccountActive(staffMemberId: string | null): Promise<boolean> {
    if (!staffMemberId) return false;
    const staff = await prisma.staffMember.findUnique({
      where: { id: staffMemberId },
      select: { isActive: true },
    });
    return !!staff && staff.isActive;
  }

  async getUserById(id: string): Promise<AuthUser | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        staffMemberId: true,
        isActive: true,
      },
    });
    if (!user || !user.isActive) return null;

    if (user.role === 'ASSISTANT') {
      const active = await this.isAssistantAccountActive(user.staffMemberId);
      if (!active) return null;
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      staffMemberId: user.staffMemberId,
    };
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        staffMemberId: true,
        isActive: true,
        passwordHash: true,
      },
    });

    if (!user || !user.isActive) {
      logger.warn(`[auth] Login failed — user not found or inactive: ${email}`);
      return { status: 'invalid_credentials' };
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      logger.warn(`[auth] Login failed — wrong password: ${email}`);
      return { status: 'invalid_credentials' };
    }

    if (user.role === 'ASSISTANT') {
      const active = await this.isAssistantAccountActive(user.staffMemberId);
      if (!active) {
        logger.warn(`[auth] Login blocked — assistant account inactive: ${email}`);
        return { status: 'assistant_inactive' };
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      staffMemberId: user.staffMemberId,
    };
    const token = this.createJwt(authUser);

    logger.info(`[auth] Login OK — ${user.email} (${user.role})`);
    return { status: 'ok', token, user: authUser };
  }
}

export const authService = new AuthService();
export { ASSISTANT_INACTIVE_MSG };
