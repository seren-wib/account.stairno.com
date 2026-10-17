import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestApp } from '../helpers/app';
import { post, sessionUser, signIn, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// One user signed in on three devices: the sign-up session plus two sign-ins.
async function threeDevices() {
  const ctx = await createTestApp();
  const { email, cookie: laptop } = await signUp(ctx.app);
  const { cookie: phone } = await signIn(ctx.app, email);
  const { cookie: tablet } = await signIn(ctx.app, email);
  const sessionCount = async () => {
    const rows = await ctx.db.execute(sql`select count(*)::int as n from "session"`);
    return (rows.rows[0] as { n: number }).n;
  };
  return { ...ctx, laptop, phone, tablet, sessionCount };
}

describe('sign-out', () => {
  it('FR-4 signing out ends only the current session', async () => {
    const { app, laptop, phone, tablet, sessionCount } = await threeDevices();
    expect(await sessionCount()).toBe(3);

    expect((await post(app, '/auth/sign-out', {}, phone)).status).toBe(200);

    expect(await sessionCount()).toBe(2);
    expect(await sessionUser(app, phone)).toBeNull();
    expect(await sessionUser(app, laptop)).not.toBeNull();
    expect(await sessionUser(app, tablet)).not.toBeNull();
  });

  it('FR-4 signing out on all devices ends every other session and keeps the current one', async () => {
    const { app, laptop, phone, tablet, sessionCount } = await threeDevices();

    expect((await post(app, '/auth/revoke-other-sessions', {}, laptop)).status).toBe(200);

    expect(await sessionCount()).toBe(1);
    expect(await sessionUser(app, laptop)).not.toBeNull();
    expect(await sessionUser(app, phone)).toBeNull();
    expect(await sessionUser(app, tablet)).toBeNull();
  });
});
