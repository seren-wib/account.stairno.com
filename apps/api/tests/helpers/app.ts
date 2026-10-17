import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { createApp, type Deps } from '../../src/index';
import * as schema from '../../src/db/schema';

// A fresh in-memory PostgreSQL per call. Migrations are applied once tables exist.
export async function createTestDb() {
  return drizzle(new PGlite(), { schema });
}

export async function createTestApp(overrides: Partial<Deps> = {}) {
  const db = await createTestDb();
  const deps: Deps = { db, ...overrides };
  return { app: createApp(async () => deps), db };
}
