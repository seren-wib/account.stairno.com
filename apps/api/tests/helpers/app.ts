import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile } from 'node:fs/promises';
import { inject } from 'vitest';
import { createAuth, type AuthConfig } from '../../src/auth';
import { createApp, type Deps } from '../../src/index';
import * as schema from '../../src/db/schema';
import type { Mailer } from '../../src/mail';
import { createMemoryMailbox } from './mailbox';

export const API_URL = 'https://api.stairno.com';
export const ACCOUNT_URL = 'https://account.stairno.com';

// The migrated snapshot from tests/global-setup.ts, read once per test file.
let snapshot: Promise<Blob> | undefined;

// A fresh in-memory PostgreSQL with the production migrations applied, its own copy per call.
// Loading the snapshot replaces starting and migrating a new PGlite for every test.
export async function createTestDb() {
  snapshot ??= readFile(inject('migratedDataDir')).then((bytes) => new Blob([bytes]));
  const client = new PGlite({ loadDataDir: await snapshot });
  return drizzle(client, { schema });
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
