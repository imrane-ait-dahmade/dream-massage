/**
 * Idempotent data-integrity fix for the User <-> StaffMember role invariant:
 *   role = ASSISTANT        => staffMemberId must be set
 *   role IN (OWNER, ADMIN)  => staffMemberId must be null
 *
 * There is no legacy Shift.userId column to backfill from — Shift.staffMemberId is
 * already required and populated for every shift. This script only fixes the User
 * side of the relation.
 *
 * Safe by construction:
 *   - Never deletes a row.
 *   - Only direction it auto-fixes is clearing a wrongly-set staffMemberId on an
 *     OWNER/ADMIN (unambiguous — the rule says it must be null, there's nothing to
 *     guess).
 *   - Never invents a staffMemberId for an ASSISTANT missing one — that link cannot
 *     be inferred safely, so those accounts are only reported, not touched. Fix them
 *     manually (they cannot log in until fixed — see auth.service.ts
 *     isAssistantAccountActive).
 *   - Running it twice is a no-op the second time: the OWNER/ADMIN fix is a plain
 *     conditional UPDATE, and it converges after the first run.
 *
 * Usage: npx tsx scripts/backfill-staff-members.ts
 */

import { config } from 'dotenv';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

config({ path: join(process.cwd(), '.env') });
config({ path: join(process.cwd(), '..', '.env'), override: false });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  console.log('── Backfill: User <-> StaffMember role invariant ──────────────────');

  if (!process.env.DATABASE_URL) {
    console.error('  ✗ DATABASE_URL is not set. Load .env before running.');
    process.exit(1);
  }

  // ── Fixable: OWNER/ADMIN with a staffMemberId set (rule says it must be null) ──
  const wronglyLinked = await prisma.user.findMany({
    where: { role: { in: ['OWNER', 'ADMIN'] }, staffMemberId: { not: null } },
    select: { id: true, email: true, role: true, staffMemberId: true },
  });

  if (wronglyLinked.length === 0) {
    console.log('  ✓ No OWNER/ADMIN user has a staffMemberId set.');
  } else {
    for (const u of wronglyLinked) {
      console.log(`  · Clearing staffMemberId on ${u.email} (${u.role}) — was ${u.staffMemberId}`);
    }
    const { count } = await prisma.user.updateMany({
      where: { role: { in: ['OWNER', 'ADMIN'] }, staffMemberId: { not: null } },
      data: { staffMemberId: null },
    });
    console.log(`  ✓ Cleared staffMemberId on ${count} OWNER/ADMIN user(s).`);
  }

  // ── Not fixable automatically: ASSISTANT without staffMemberId ─────────────────
  // These accounts cannot log in (auth.service.isAssistantAccountActive requires a
  // staffMemberId), so leaving them broken is not a silent risk — but they need a
  // human to pick the correct StaffMember, not a guess.
  const brokenAssistants = await prisma.user.findMany({
    where: { role: 'ASSISTANT', staffMemberId: null },
    select: { id: true, email: true, name: true },
  });

  if (brokenAssistants.length === 0) {
    console.log('  ✓ No ASSISTANT user is missing a staffMemberId.');
  } else {
    console.log(`  ⚠ ${brokenAssistants.length} ASSISTANT user(s) missing staffMemberId — fix manually:`);
    for (const u of brokenAssistants) {
      console.log(`    - ${u.email} (${u.name}) — id: ${u.id}`);
    }
  }

  console.log('── Backfill done ─────────────────────────────────────────────────');

  if (brokenAssistants.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((e: unknown) => {
    console.error('Backfill failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
