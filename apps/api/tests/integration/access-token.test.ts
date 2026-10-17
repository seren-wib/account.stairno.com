import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite } from '../helpers/oidc';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const site = await registerLabs(ctx);
  const { cookie } = await signUp(ctx.app);
  const userId = ((await (await get(ctx.app, '/v1/me', cookie)).json()) as { id: string }).id;
  const tokens = await signInToSite(ctx, site, cookie, {
    scope: 'openid profile email',
    resource: API_URL,
  });
  const me = (token: string) =>
    ctx.app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } });
  return { ...ctx, userId, tokens, me };
}

describe('access token for the API', () => {
  it('FR-19 is a JWT for the API audience with scopes and a one-hour lifetime', async () => {
    const { app, tokens, userId } = await setup();
    const jwks = (await (await app.request('/auth/jwks')).json()) as JSONWebKeySet;

    const { payload } = await jwtVerify(tokens.access_token, createLocalJWKSet(jwks), {
      issuer: `${API_URL}/auth`,
      audience: API_URL,
    });

    expect(payload.sub).toBe(userId);
    expect(String(payload.scope).split(' ')).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email']),
    );
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);
    expect(tokens.expires_in).toBe(3600);
  });

  it('FR-13 FR-19 FR-23 opens /v1/me for its user', async () => {
    const { tokens, userId, me } = await setup();

    const res = await me(tokens.access_token);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(userId);
  });

  it('FR-19 is refused an hour later', async () => {
    const { tokens, me } = await setup();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3600 * 1000 + 5000);

    expect((await me(tokens.access_token)).status).toBe(401);
  });
});
