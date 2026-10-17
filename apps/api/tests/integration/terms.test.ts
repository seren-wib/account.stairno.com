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
    sql`select terms_version, terms_accepted_at from "user" order by created_at`,
  );
  return rows.rows as { terms_version: string | null; terms_accepted_at: Date | null }[];
}

describe('terms acceptance on sign-up', () => {
  it('FR-9 stores the accepted terms version and the time of acceptance', async () => {
    const { app, db } = await createTestApp();
    const before = Date.now();

    expect((await signUp(app)).res.status).toBe(200);

    const [user] = await users(db);
    expect(user?.terms_version).toBe(termsVersion);
    const acceptedAt = new Date(user?.terms_accepted_at ?? 0).getTime();
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
      expect(new Date(user.terms_accepted_at ?? 0).getFullYear()).not.toBe(2000);
    }
  });
});
