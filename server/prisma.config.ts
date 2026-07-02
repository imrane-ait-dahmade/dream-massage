import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma CLI (migrate, db pull, etc.) needs a direct Postgres connection.
// Neon pooled URLs (-pooler) cannot reliably acquire advisory locks (P1002).
const migrationUrl = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];

if (!migrationUrl) {
  throw new Error(
    '[prisma.config] DIRECT_URL or DATABASE_URL must be set for Prisma CLI.',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: migrationUrl,
  },
});
