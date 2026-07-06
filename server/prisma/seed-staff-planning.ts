/**
 * Alias entry point — same JSON-driven seed as prisma/seed.ts.
 * Kept for backwards compatibility with npm run prisma:seed:staff-planning.
 */
import {
  assertStaffPlanningSeedAllowed,
  createSeedPrisma,
  IS_PRODUCTION,
} from './seeds/seed-runtime';
import { seedFromJson } from './seeds/seed-from-json';

async function main(): Promise<void> {
  console.log('');
  console.log('  dreamMassage — staff & planning seed (JSON)');
  console.log(`  env : ${IS_PRODUCTION ? 'production' : 'development'}`);
  console.log('');

  assertStaffPlanningSeedAllowed();

  const { prisma, pool } = createSeedPrisma();
  const seedAssistants = process.env.SEED_ASSISTANT_USERS === 'true';

  try {
    await seedFromJson(prisma, {
      isProduction: IS_PRODUCTION,
      seedAssistantUsers: seedAssistants,
      resetPasswords: process.env.RESET_ASSISTANT_PASSWORDS === 'true',
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error('Staff-planning seed failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
