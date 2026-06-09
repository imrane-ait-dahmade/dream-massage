import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

function createClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('[prisma] DATABASE_URL is not set');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Prevent multiple PrismaClient instances during tsx hot-reload in development.
const g = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma: PrismaClient = g.__prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  g.__prisma = prisma;
}
