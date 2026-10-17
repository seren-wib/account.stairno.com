import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestApp } from '../helpers/app';
import { PASSWORD, post, sessionUser, signIn, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const { email, cookie } = await signUp(ctx.app);
  const { cookie: otherDevice } = await signIn(ctx.app, email);
  const count = async (table: string) => {
    const rows = await ctx.db.execute(sql.raw(`select count(*)::int as n from "${table}"`));
    return (rows.rows[0] as { n: number }).n;
  };
  const deleteAccount = (body: Record<string, unknown>) =>
    post(ctx.app, '/auth/delete-user', body, cookie);
  return { ...ctx, email, cookie, otherDevice, count, deleteAccount };
}

// A site this user signed in to: a client, the consent and a refresh token (UC-12).
async function connectSite(db: Awaited<ReturnType<typeof setup>>['db'], email: string) {
  await db.execute(sql`
    insert into oauth_client (client_id, redirect_uris, name)
    values ('labs', array['https://stairnolabs.com/callback'], 'Labs')`);
  await db.execute(sql`
    insert into oauth_consent (client_id, user_id, scopes, created_at, updated_at)
    select 'labs', id, array['openid'], now(), now() from "user" where email = ${email}`);
  await db.execute(sql`
    insert into oauth_refresh_token (token, client_id, user_id, scopes, expires_at, created_at)
    select 'refresh-token-hash', 'labs', id, array['openid', 'offline_access'],
      now() + interval '90 days', now()
    from "user" where email = ${email}`);
}

describe('POST /auth/delete-user', () => {
  it('FR-8 deletes the account right after the password is confirmed and signs out everywhere', async () => {
    const { app, email, cookie, otherDevice, count, deleteAccount } = await setup();

    expect((await deleteAccount({ password: PASSWORD })).status).toBe(200);

    expect(await count('user')).toBe(0);
    expect(await count('session')).toBe(0);
    expect(await count('account')).toBe(0);
    expect(await sessionUser(app, cookie)).toBeNull();
    expect(await sessionUser(app, otherDevice)).toBeNull();
    expect((await signIn(app, email)).res.status).toBe(401);
  });

  it('FR-8 UC-12 removes the site consents and refresh tokens with the account', async () => {
    const { db, email, count, deleteAccount } = await setup();
    await connectSite(db, email);
    expect(await count('oauth_consent')).toBe(1);
    expect(await count('oauth_refresh_token')).toBe(1);

    expect((await deleteAccount({ password: PASSWORD })).status).toBe(200);

    expect(await count('oauth_consent')).toBe(0);
    expect(await count('oauth_refresh_token')).toBe(0);
  });

  it('FR-8 refuses without the password, even on a fresh session', async () => {
    const { app, cookie, count, deleteAccount } = await setup();

    expect((await deleteAccount({})).status).toBe(400);

    expect(await count('user')).toBe(1);
    expect(await sessionUser(app, cookie)).not.toBeNull();
  });

  it('FR-8 refuses a wrong password', async () => {
    const { count, deleteAccount } = await setup();

    expect((await deleteAccount({ password: 'not-the-password-1' })).status).toBe(400);

    expect(await count('user')).toBe(1);
  });
});
