/**
 * One-shot: disable F1/F2, re-enable, list/delete sessions since yesterday.
 * Run: npx tsx -r dotenv/config scripts/admin-f1-f2-and-cleanup.ts [--apply]
 */
import 'dotenv/config';
import { prisma } from '../prisma';
import { settingsService } from '../modules/settings/settings.service';
import { sessionService } from '../modules/sessions/session.service';
import { assessSessionDeletion } from '../modules/sessions/session-delete.logic';

const APPLY = process.argv.includes('--apply');

function sinceYesterdayUtc(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Orphan stale session (F2, started 2026-09-04). */
const EXTRA_ORPHAN_SESSION_IDS = ['74db1389-2e8c-4c41-a26e-308eabfc21ae'] as const;

async function main() {
  const since = sinceYesterdayUtc();
  console.log(JSON.stringify({ mode: APPLY ? 'APPLY' : 'DRY_RUN', since: since.toISOString() }, null, 2));

  const f1f2 = await prisma.chair.findMany({
    where: { name: { in: ['F1', 'F2'] } },
    select: { id: true, name: true, isEnabled: true, status: true, currentSessionId: true },
    orderBy: { name: 'asc' },
  });

  console.log('\n--- F1/F2 before ---');
  console.log(JSON.stringify(f1f2, null, 2));

  if (APPLY) {
    for (const chair of f1f2) {
      if (chair.isEnabled) {
        const r = await settingsService.updateChair(chair.id, { isEnabled: false });
        console.log(`Disabled ${chair.name}:`, r);
      }
    }
  }

  const sessions = await prisma.chairSession.findMany({
    where: {
      chair: { name: { in: ['F1', 'F2'] } },
      archivedAt: null,
      OR: [
        { startedAt: { gte: since } },
        { id: { in: [...EXTRA_ORPHAN_SESSION_IDS] } },
      ],
    },
    orderBy: { startedAt: 'desc' },
    include: {
      chair: { select: { name: true } },
      _count: { select: { chairEvents: true, planChangeRequests: true } },
    },
  });

  console.log(`\n--- F1/F2 sessions to remove (${sessions.length}) ---`);
  const plan: Array<Record<string, unknown>> = [];

  for (const s of sessions) {
    const assessment = assessSessionDeletion({
      shiftId: s.shiftId,
      chairEventsCount: s._count.chairEvents,
      billingStatus: s.billingStatus,
      correctedAmount: s.correctedAmount != null ? Number(s.correctedAmount) : null,
      expectedAmount: s.expectedAmount != null ? Number(s.expectedAmount) : null,
      planChangeRequestsCount: s._count.planChangeRequests,
    });
    plan.push({
      id: s.id,
      chair: s.chair.name,
      status: s.status,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      shiftId: s.shiftId,
      billingStatus: s.billingStatus,
      expectedAmount: s.expectedAmount,
      events: s._count.chairEvents,
      action: assessment.mustArchive ? 'archive' : 'hard_delete',
      reasons: assessment.reasons,
    });
  }
  console.log(JSON.stringify(plan, null, 2));

  if (!APPLY) {
    console.log('\nDry run only. Pass --apply to execute disable/enable and session cleanup.');
    return;
  }

  const actor = await prisma.user.findFirst({
    where: { role: { in: ['OWNER', 'ADMIN'] }, isActive: true },
    select: { id: true, role: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!actor) throw new Error('No OWNER/ADMIN user for deleteSession actor');

  const results: Array<Record<string, unknown>> = [];
  for (const s of sessions) {
    try {
      const r = await sessionService.deleteSession(
        s.id,
        { id: actor.id, role: actor.role as 'OWNER' | 'ADMIN', staffMemberId: null, name: actor.name, email: '' },
        'Admin cleanup: F1/F2 sessions since yesterday',
      );
      results.push({ id: s.id, chair: s.chair.name, ...r });
    } catch (err) {
      results.push({ id: s.id, chair: s.chair.name, error: String(err) });
    }
  }

  const after = await prisma.chair.findMany({
    where: { name: { in: ['F1', 'F2'] } },
    select: { name: true, isEnabled: true, status: true, currentSessionId: true },
    orderBy: { name: 'asc' },
  });

  console.log('\n--- Delete results ---');
  console.log(JSON.stringify(results, null, 2));
  console.log('\n--- F1/F2 after delete (still disabled) ---');
  console.log(JSON.stringify(after, null, 2));

  for (const chair of f1f2) {
    const r = await settingsService.updateChair(chair.id, { isEnabled: true });
    console.log(`Re-enabled ${chair.name}:`, r);
  }

  const finalChairs = await prisma.chair.findMany({
    where: { name: { in: ['F1', 'F2'] } },
    select: { name: true, isEnabled: true, status: true, currentSessionId: true },
    orderBy: { name: 'asc' },
  });
  console.log('\n--- F1/F2 final (re-enabled) ---');
  console.log(JSON.stringify(finalChairs, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
