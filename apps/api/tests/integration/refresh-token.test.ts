import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestApp } from '../helpers/app';
import { signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, tokenRequest, type TokenResponse } from '../helpers/oidc';

const DAY = 24 * 60 * 60;

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup(scope = 'openid profile email offline_access') {
  const ctx = await createTestApp();
  const site = await registerLabs(ctx);
  const { cookie } = await signUp(ctx.app);
  const tokens = await signInToSite(ctx, site, cookie, { scope });
  const refresh = (refreshToken: string) =>
    tokenRequest(ctx.app, site, { grant_type: 'refresh_token', refresh_token: refreshToken });
  return { ...ctx, site, tokens, refresh };
}

describe('refresh tokens', () => {
  it('FR-20 come only with offline_access', async () => {
    const without = await setup('openid profile email');
    const withOffline = await setup();

    expect(without.tokens.refresh_token).toBeUndefined();
    expect(withOffline.tokens.refresh_token).toBeTruthy();
  });

  it('FR-20 rotate: a refresh returns a new refresh token and a new access token', async () => {
    const { tokens, refresh } = await setup();

    const res = await refresh(tokens.refresh_token ?? '');

    expect(res.status).toBe(200);
    const next = (await res.json()) as TokenResponse;
    expect(next.refresh_token).toBeTruthy();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.access_token).toBeTruthy();
  });

  it('FR-20 refuse a refresh token that was already used', async () => {
    const { tokens, refresh } = await setup();
    expect((await refresh(tokens.refresh_token ?? '')).status).toBe(200);

    const replay = await refresh(tokens.refresh_token ?? '');

    expect(replay.status).toBe(400);
  });

  it('FR-20 last 90 days', async () => {
    const { db } = await setup();

    const rows = await db.execute(sql`
      select extract(epoch from expires_at) - extract(epoch from created_at) as seconds
      from oauth_refresh_token`);

    expect(Math.round(Number((rows.rows[0] as { seconds: string }).seconds))).toBe(90 * DAY);
  });
});
