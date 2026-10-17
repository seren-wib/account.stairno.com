import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { createAuth } from '../../src/auth';
import { createApp, type Deps } from '../../src/index';
import * as schema from '../../src/db/schema';

export const API_URL = 'https://api.stairno.com';
export const ACCOUNT_URL = 'https://account.stairno.com';

const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

// A fresh in-memory PostgreSQL with the production migrations applied.
export async function createTestDb() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

export async function createTestApp(overrides: Partial<Deps> = {}) {
  const db = await createTestDb();
  const auth = createAuth({
    db,
    apiUrl: API_URL,
    accountUrl: ACCOUNT_URL,
    cookieDomain: 'stairno.com',
    secret: 'test-secret-not-used-anywhere-else-0123456789',
  });
  const deps: Deps = { db, auth, ...overrides };
  return { app: createApp(async () => deps), db, auth };
}
