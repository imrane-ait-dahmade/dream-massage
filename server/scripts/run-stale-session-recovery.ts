/**
 * One-shot stale session recovery (production repair).
 * Run: npx tsx -r dotenv/config scripts/run-stale-session-recovery.ts
 */
import 'dotenv/config';
import { runStaleSessionRecovery } from '../modules/sessions/session-stale-recovery.service';

async function main() {
  const recovered = await runStaleSessionRecovery(true);
  console.log(JSON.stringify({ recovered, at: new Date().toISOString() }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('../prisma');
    await prisma.$disconnect();
  });
