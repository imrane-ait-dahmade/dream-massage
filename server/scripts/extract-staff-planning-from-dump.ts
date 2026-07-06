/**
 * Regenerate prisma/seeds/staff-planning-data.ts from a pg_dump custom backup.
 *
 * Usage (Windows):
 *   npm run extract:staff-planning -- "C:\path\to\dream-massage-backup.dump"
 *
 * Requires local PostgreSQL + pg_restore on PATH (or PG_BIN env).
 * Creates a temporary database, applies Prisma migrations, restores selected
 * tables, prints a summary — does NOT overwrite files automatically.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const TEMP_DB = process.env.EXTRACT_TEMP_DB ?? 'dream_massage_extract';
const PG_BIN = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\18\\bin';

function pg(cmd: string): string {
  const exe = process.platform === 'win32'
    ? `"${PG_BIN}\\${cmd}.exe"`
    : cmd;
  return exe;
}

function run(cmd: string, opts?: { env?: NodeJS.ProcessEnv }): void {
  execSync(cmd, {
    stdio: 'inherit',
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, ...opts?.env },
  });
}

async function query<T extends Record<string, unknown>>(pool: Pool, sql: string): Promise<T[]> {
  const { rows } = await pool.query<T>(sql);
  return rows;
}

async function main(): Promise<void> {
  const dumpPath = process.argv[2];
  if (!dumpPath || !existsSync(dumpPath)) {
    console.error('Usage: npm run extract:staff-planning -- <path-to.dump>');
    process.exit(1);
  }

  const absDump = resolve(dumpPath);
  const dbUrl = process.env.DATABASE_URL?.replace(/\/[^/?]+(\?|$)/, `/${TEMP_DB}$1`)
    ?? `postgresql://postgres@localhost:5432/${TEMP_DB}?schema=public`;

  console.log(`\nExtracting from: ${absDump}`);
  console.log(`Temp database  : ${TEMP_DB}\n`);

  run(`${pg('dropdb')} --if-exists -U postgres ${TEMP_DB}`);
  run(`${pg('createdb')} -U postgres ${TEMP_DB}`);

  run(`npx prisma migrate deploy`, { env: { DATABASE_URL: dbUrl } });

  const tables = [
    'staff_members',
    'shift_types',
    'staff_schedules',
    'shift_target_bonus_rules',
    'users',
  ];
  for (const t of tables) {
    run(`${pg('pg_restore')} -U postgres -d ${TEMP_DB} --no-owner --no-privileges --data-only -t ${t} "${absDump}"`);
  }

  const pool = new Pool({ connectionString: dbUrl });

  const staff = await query<{ id: string; name: string }>(pool,
    `SELECT id, name FROM staff_members
     WHERE archived_at IS NULL AND is_active = true AND name NOT ILIKE 'demo%'
     ORDER BY name`);

  const shiftTypes = await query<{ name: string; start_time: string; end_time: string }>(pool,
    `SELECT name, start_time, end_time FROM shift_types WHERE is_active = true ORDER BY sort_order`);

  const schedules = await query<{
    staff_name: string;
    day_of_week: number;
    shift_name: string | null;
    is_off: boolean;
  }>(pool,
    `SELECT sm.name AS staff_name, ss.day_of_week, st.name AS shift_name, ss.is_off
     FROM staff_schedules ss
     JOIN staff_members sm ON sm.id = ss.staff_member_id
     LEFT JOIN shift_types st ON st.id = ss.shift_type_id
     WHERE ss.is_active = true AND ss.archived_at IS NULL
       AND sm.name NOT ILIKE 'demo%'
     ORDER BY sm.name, ss.day_of_week, st.sort_order NULLS LAST`);

  const assistants = await query<{ id: string; email: string; name: string; staff_member_id: string }>(pool,
    `SELECT u.id, u.email, u.name, u.staff_member_id
     FROM users u
     WHERE u.role = 'ASSISTANT' AND u.is_active = true`);

  const bonus = await query<{ shift_type_id: string; target_amount: string; bonus_amount: string }>(pool,
    `SELECT shift_type_id, target_amount::text, bonus_amount::text
     FROM shift_target_bonus_rules WHERE is_active = true`);

  console.log('\n── Summary (paste into staff-planning-data.ts) ─────────────────\n');
  console.log('STAFF_MEMBERS:', JSON.stringify(staff, null, 2));
  console.log('\nSHIFT_TYPES (production — apply canonical hours in data file):', JSON.stringify(shiftTypes, null, 2));
  console.log('\nWEEKLY_PLANNING (expand JOURNEE → MATIN+SOIR manually):', JSON.stringify(schedules, null, 2));
  console.log('\nASSISTANT_USERS (never export password_hash):', JSON.stringify(assistants, null, 2));
  console.log('\nBONUS_RULES:', JSON.stringify(bonus, null, 2));

  await pool.end();
  console.log('\nDone. Update staff-planning-data.ts manually, then run prisma:seed:staff-planning.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
