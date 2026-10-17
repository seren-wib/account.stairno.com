import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { createAuth, type AuthConfig } from '../../src/auth';
import { createApp, type Deps } from '../../src/index';
import * as schema from '../../src/db/schema';
import type { Mailer } from '../../src/mail';
import { createMemoryMailbox } from './mailbox';

export const API_URL = 'https://api.stairno.com';
export const ACCOUNT_URL = 'https://account.stairno.com';

const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

// A fresh in-memory PostgreSQL with the production migrations applied.
export async function createTestDb() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

type UrlConfig = Pick<AuthConfig, 'apiUrl' | 'accountUrl' | 'cookieDomain'>;

export async function createTestApp(
  overrides: Partial<Deps> = {},
  urls: Partial<UrlConfig> = {},
  mailer?: Mailer,
) {
  const db = await createTestDb();
  const mailbox = createMemoryMailbox();
  const auth = createAuth({
    db,
    mailer: mailer ?? mailbox,
    apiUrl: API_URL,
    accountUrl: ACCOUNT_URL,
    cookieDomain: 'stairno.com',
    secret: 'test-secret-not-used-anywhere-else-0123456789',
    ...urls,
  });
  const deps: Deps = { db, auth, ...overrides };
  return { app: createApp(async () => deps), db, auth, mailbox };
}
