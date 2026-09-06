/**
 * Read-only report of stale ACTIVE sessions (e.g. F1/F2 in production).
 * Does NOT modify data. Run: npx tsx scripts/stale-session-repair-report.ts
 */
import { prisma } from '../prisma';
import {
  evaluateStaleSessionRecovery,
  resolveReliableEndMs,
  type StaleSessionCandidate,
} from '../modules/sessions/session-stale-recovery.logic';
import { pricingService } from '../modules/pricing/pricing.service';

async function lastLowPowerEventMs(sessionId: string): Promise<number | null> {
  const ev = await prisma.chairEvent.findFirst({
    where: { sessionId, eventType: 'LOW_POWER_DETECTED' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return ev?.createdAt.getTime() ?? null;
}

async function main() {
  const openCount = await prisma.shift.count({ where: { status: 'OPEN', endedAt: null } });
  const nowMs = Date.now();

  const chairs = await prisma.chair.findMany({
    where: {
      isEnabled: true,
      OR: [
        { status: { in: ['ACTIVE', 'MAYBE_FINISHED'] } },
        { sessions: { some: { status: 'ACTIVE' } } },
      ],
    },
    orderBy: { name: 'asc' },
    include: {
      detectionConfigs: { where: { isActive: true }, take: 1 },
      sessions: {
        where: { status: 'ACTIVE' },
        take: 1,
        orderBy: { startedAt: 'desc' },
        include: { shift: { select: { id: true, status: true } } },
      },
    },
  });

  const rows: Record<string, unknown>[] = [];

  for (const chair of chairs) {
    const session = chair.sessions[0];
    if (!session) continue;

    const cfg = chair.detectionConfigs[0];
    const stopThreshold = cfg?.stopThresholdWatts ?? 5;
    const stopConfirm = cfg?.stopConfirmSeconds ?? 180;
    const lastLow = await lastLowPowerEventMs(session.id);

    const candidate: StaleSessionCandidate = {
      sessionId: session.id,
      chairId: chair.id,
      chairStatus: chair.status,
      sessionStatus: session.status,
      startedAtMs: session.startedAt.getTime(),
      maybeFinishedSinceMs: chair.maybeFinishedSince?.getTime() ?? null,
      lowPowerDetectedAtMs: session.lowPowerDetectedAt?.getTime() ?? null,
      lastLowPowerEventMs: lastLow,
      currentPowerWatts: chair.currentPowerWatts,
      stopThresholdWatts: stopThreshold,
      stopConfirmSeconds: stopConfirm,
      nowMs,
      shiftId: session.shiftId,
      shiftStatus: session.shift?.status ?? null,
      hasOpenShopShift: openCount === 1,
    };

    const decision = evaluateStaleSessionRecovery(candidate);
    const reliableEndMs = resolveReliableEndMs(candidate);

    let correctedAmount: number | null = null;
    if (decision.action === 'finalize' && reliableEndMs != null) {
      const durationSeconds = Math.max(
        0,
        Math.floor((reliableEndMs - session.startedAt.getTime()) / 1000),
      );
      const pricing = await pricingService.calculateSessionPrice(durationSeconds);
      correctedAmount = pricing.expectedAmount;
    }

    rows.push({
      chair: chair.name,
      sessionId: session.id,
      status: session.status,
      chairStatus: chair.status,
      shiftId: session.shiftId,
      shiftStatus: session.shift?.status ?? null,
      startedAt: session.startedAt.toISOString(),
      maybeFinishedSince: chair.maybeFinishedSince?.toISOString() ?? null,
      lastLowPowerDetected: lastLow ? new Date(lastLow).toISOString() : null,
      currentPowerWatts: chair.currentPowerWatts,
      billingStatus: session.billingStatus,
      expectedAmount: session.expectedAmount != null ? Number(session.expectedAmount) : null,
      recoveryAction: decision.action,
      recoveryReason: decision.action !== 'none' ? (decision as { reason: string }).reason : null,
      correctedEndAt: reliableEndMs ? new Date(reliableEndMs).toISOString() : null,
      correctedAmount,
    });
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), openShifts: openCount, rows }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
