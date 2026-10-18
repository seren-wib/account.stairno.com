import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { ACCOUNT_URL, HUB_URL, createTestApp } from '../helpers/app';
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

  // NFR-5: the session cookie rides along on any same-site request, so ending sessions must come
  // from a trusted origin, like every other state change. Better Auth's origin check does this in
  // production; these cases make sure the tests run it too.
  it.each(['/auth/sign-out', '/auth/revoke-other-sessions', '/auth/revoke-sessions'])(
    'NFR-5 refuses %s from an unknown origin and keeps the sessions',
    async (path) => {
      const { app, laptop, phone, sessionCount } = await threeDevices();

      const res = await post(app, path, {}, laptop, { origin: 'https://evil.example' });

      expect(res.status).toBe(403);
      expect(await sessionCount()).toBe(3);
      expect(await sessionUser(app, laptop)).not.toBeNull();
      expect(await sessionUser(app, phone)).not.toBeNull();
    },
  );

  it('NFR-5 refuses a sign-out with a session cookie but no Origin', async () => {
    const { app, laptop, sessionCount } = await threeDevices();

    const res = await app.request('/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: laptop },
      body: '{}',
    });

    expect(res.status).toBe(403);
    expect(await sessionCount()).toBe(3);
  });

  it.each([
    ['the account center', ACCOUNT_URL],
    ['the hub', HUB_URL],
  ])('NFR-5 FR-80 lets %s sign out', async (_name, origin) => {
    const { app, phone, sessionCount } = await threeDevices();

    const res = await post(app, '/auth/sign-out', {}, phone, { origin });

    expect(res.status).toBe(200);
    expect(await sessionCount()).toBe(2);
  });
});
