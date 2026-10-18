import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile } from 'node:fs/promises';
import { inject } from 'vitest';
import { createAuth, type AuthConfig } from '../../src/auth';
import { createApp, type Deps } from '../../src/index';
import * as schema from '../../src/db/schema';
import type { Mailer } from '../../src/mail';
import { removeBillingKeysOf } from '../../src/payments/account-deletion';
import { removeAvatarsOf } from '../../src/avatars/store';
import { createFakeProvider } from '../../src/payments/fake';
import { createMemoryMailbox } from './mailbox';

export const API_URL = 'https://api.stairno.com';
export const ACCOUNT_URL = 'https://account.stairno.com';
export const HUB_URL = 'https://stairno.com';

// The migrated snapshot from tests/global-setup.ts, read once per test file.
let snapshot: Promise<Blob> | undefined;

// A fresh in-memory PostgreSQL with the production migrations applied, its own copy per call.
// Loading the snapshot replaces starting and migrating a new PGlite for every test.
export async function createTestDb() {
  snapshot ??= readFile(inject('migratedDataDir')).then((bytes) => new Blob([bytes]));
  const client = new PGlite({ loadDataDir: await snapshot });
  return drizzle(client, { schema });
}

type UrlConfig = Pick<AuthConfig, 'apiUrl' | 'accountUrl' | 'hubUrl' | 'cookieDomain'>;

// Providers are merged one by one, so a test that brings its own Toss keeps the fake PayPal.
type Overrides = Partial<Omit<Deps, 'providers'>> & { providers?: Partial<Deps['providers']> };

export async function createTestApp(
  overrides: Overrides = {},
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
    hubUrl: HUB_URL,
    cookieDomain: 'stairno.com',
    secret: 'test-secret-not-used-anywhere-else-0123456789',
    // Reads `deps` only when an account is deleted, after it exists, and sees what a test swapped.
    beforeDeleteUser: async (userId) => {
      await removeBillingKeysOf(deps, userId);
      await removeAvatarsOf(deps, userId);
    },
    ...urls,
  });
  const origins = { account: urls.accountUrl ?? ACCOUNT_URL, hub: urls.hubUrl ?? HUB_URL };
  const { providers, ...rest } = overrides;
  const deps: Deps = {
    db,
    auth,
    apiUrl: urls.apiUrl ?? API_URL,
    origins,
    paymentsMode: 'test',
    billingKeySecret: 'test-billing-key-secret-not-used-anywhere-else',
    downloadSecret: 'test-download-secret-not-used-anywhere-else',
    mailer: mailer ?? mailbox,
    ...rest,
    providers: { toss: createFakeProvider(), paypal: createFakeProvider(), ...providers },
  };
  // `deps` is the object every request reads, so a test may swap a part of it afterwards.
  return { app: createApp(async () => deps), db, auth, mailbox, deps };
}
