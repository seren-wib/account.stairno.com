import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { termsVersion } from '@stairno-account/contract';
import { createTestApp } from '../helpers/app';
import { signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function users(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const rows = await db.execute(
    // Better Auth's columns are timestamp without time zone holding UTC; epoch reads them as UTC
    // whatever the machine's zone.
    sql`select terms_version, extract(epoch from terms_accepted_at) * 1000 as accepted_ms
        from "user" order by created_at`,
  );
  return rows.rows as { terms_version: string | null; accepted_ms: string | number | null }[];
}

describe('terms acceptance on sign-up', () => {
  it('FR-9 stores the accepted terms version and the time of acceptance', async () => {
    const { app, db } = await createTestApp();
    const before = Date.now();

    expect((await signUp(app)).res.status).toBe(200);

    const [user] = await users(db);
    expect(user?.terms_version).toBe(termsVersion);
    const acceptedAt = Number(user?.accepted_ms);
    expect(acceptedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(acceptedAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('FR-9 rejects a sign-up that did not accept the terms', async () => {
    const { app, db } = await createTestApp();

    expect((await signUp(app, { termsVersion: undefined })).res.status).toBe(400);

    expect(await users(db)).toHaveLength(0);
  });

  it('FR-9 rejects an outdated terms version', async () => {
    const { app, db } = await createTestApp();

    expect((await signUp(app, { termsVersion: '2000-01-01' })).res.status).toBe(400);

    expect(await users(db)).toHaveLength(0);
  });

  it('FR-9 does not take the acceptance time from the client', async () => {
    const { app, db } = await createTestApp();

    await signUp(app, { termsAcceptedAt: '2000-01-01T00:00:00.000Z' });

    for (const user of await users(db)) {
      expect(new Date(Number(user.accepted_ms)).getUTCFullYear()).not.toBe(2000);
    }
  });
});
