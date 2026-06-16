import { prisma } from '../../prisma';
import { sessionSettingsService } from '../settings/session-settings.service';
import type { AuthUser } from '../auth/auth.service';

// Resolve actor userId — falls back to first OWNER from DB
async function resolveActorUserId(user?: AuthUser | null): Promise<string | null> {
  if (user?.id) return user.id;
  try {
    const owner = await prisma.user.findFirst({
      where: { role: 'OWNER', isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return owner?.id ?? null;
  } catch {
    return null;
  }
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function finalAmt(expected: unknown, corrected: unknown): number {
  return toNum(corrected) ?? toNum(expected) ?? 0;
}

const SESSION_INCLUDE = {
  chair:       { select: { name: true, displayName: true } },
  matchedPlan: { select: { name: true } },
} as const;

type FetchedSession = Prisma.ChairSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

import { Prisma } from '@prisma/client';

function mapSession(s: FetchedSession) {
  return {
    id:               s.id,
    chairId:          s.chairId,
    chairName:        s.chair.name,
    chairDisplayName: s.chair.displayName,
    status:           s.status,
    startedAt:        s.startedAt.toISOString(),
    endedAt:          s.endedAt?.toISOString()      ?? null,
    durationSeconds:  s.durationSeconds,
    matchedPlanName:  s.matchedPlan?.name           ?? null,
    matchedPlanId:    s.matchedPlanId,
    expectedAmount:   toNum(s.expectedAmount),
    correctedAmount:  toNum(s.correctedAmount),
    finalAmount:      finalAmt(s.expectedAmount, s.correctedAmount),
    billingStatus:    s.billingStatus,
    anomalyType:      s.anomalyType,
    correctionReason: s.correctionReason,
    correctedAt:      s.correctedAt?.toISOString() ?? null,
    notes:            s.notes,
  };
}

export const sessionService = {
  async getById(sessionId: string) {
    const s = await prisma.chairSession.findUnique({
      where:   { id: sessionId },
      include: SESSION_INCLUDE,
    });
    if (!s) return null;
    return mapSession(s);
  },

  async correctSession(
    sessionId: string,
    input: {
      correctedAmount?:  number;
      correctionReason?: string;
      notes?:            string;
      clearCorrection?:  boolean;
    },
    actor?: AuthUser | null,
  ) {
    const session = await prisma.chairSession.findUnique({ where: { id: sessionId } });
    if (!session) return null;

    const allowCorrection = await sessionSettingsService.getAllowManualCorrection();
    if (!allowCorrection) {
      throw Object.assign(
        new Error('Les corrections manuelles sont désactivées.'),
        { status: 403 },
      );
    }

    const reasonRequired = await sessionSettingsService.getCorrectionReasonRequired();
    const actorUserId    = await resolveActorUserId(actor);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {
      correctedAt:       new Date(),
      correctedByUserId: actorUserId,
    };

    if (input.clearCorrection) {
      if (reasonRequired && !input.correctionReason?.trim()) {
        throw Object.assign(
          new Error('La raison est obligatoire pour effacer une correction.'),
          { status: 400 },
        );
      }
      data.correctedAmount  = null;
      data.correctionReason = input.correctionReason ?? null;
      data.billingStatus    = session.expectedAmount != null ? 'CALCULATED' : 'PENDING';
    } else {
      if (input.correctedAmount === undefined) {
        throw Object.assign(new Error('correctedAmount est obligatoire.'), { status: 400 });
      }
      if (input.correctedAmount < 0) {
        throw Object.assign(new Error('correctedAmount doit être >= 0.'), { status: 400 });
      }
      if (reasonRequired && !input.correctionReason?.trim()) {
        throw Object.assign(new Error('La raison de correction est obligatoire.'), { status: 400 });
      }
      data.correctedAmount  = input.correctedAmount;
      data.correctionReason = input.correctionReason ?? null;
      data.billingStatus    = 'CORRECTED';
    }

    if (input.notes !== undefined) data.notes = input.notes;

    const updated = await prisma.chairSession.update({
      where:   { id: sessionId },
      data,
      include: SESSION_INCLUDE,
    });

    // Audit event (non-blocking)
    prisma.chairEvent
      .create({
        data: {
          chairId:   session.chairId,
          sessionId,
          eventType: 'SESSION_CORRECTED',
          metadata: {
            oldCorrectedAmount: session.correctedAmount != null ? Number(session.correctedAmount) : null,
            newCorrectedAmount: input.clearCorrection ? null : (input.correctedAmount ?? null),
            expectedAmount:     session.expectedAmount != null ? Number(session.expectedAmount) : null,
            reason:             input.correctionReason ?? null,
            userId:             actorUserId,
            cleared:            !!input.clearCorrection,
          },
        },
      })
      .catch(() => {});

    return mapSession(updated);
  },
};
