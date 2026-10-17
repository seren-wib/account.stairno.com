import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// An access token as the OIDC provider issues it (FR-19), signed with the API's own key.
async function accessToken(auth: TestApp['auth'], claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const { token } = await auth.api.signJWT({
    body: {
      payload: {
        iss: `${API_URL}/auth`,
        aud: [API_URL],
        scope: 'openid profile email',
        iat: now,
        exp: now + 3600,
        ...claims,
      },
    },
  });
  return token;
}

async function me(app: TestApp['app'], token: string, cookie?: string) {
  return app.request('/v1/me', {
    headers: { authorization: `Bearer ${token}`, ...(cookie ? { cookie } : {}) },
  });
}

async function userId(app: TestApp['app'], cookie: string) {
  const res = await get(app, '/v1/me', cookie);
  return ((await res.json()) as { id: string }).id;
}

describe('Bearer access tokens', () => {
  it('FR-13 FR-23 identifies the user from a Bearer access token', async () => {
    const { app, auth } = await createTestApp();
    const { email, cookie } = await signUp(app);
    const sub = await userId(app, cookie);

    const res = await me(app, await accessToken(auth, { sub }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: sub, email });
  });

  it('FR-13 uses the Bearer token when a cookie is also sent', async () => {
    const { app, auth } = await createTestApp();
    const { cookie: alice } = await signUp(app);
    const { cookie: bob } = await signUp(app);
    const bobId = await userId(app, bob);

    const res = await me(app, await accessToken(auth, { sub: bobId }), alice);

    expect(((await res.json()) as { id: string }).id).toBe(bobId);
  });

  it('FR-13 FR-19 rejects a token for another audience', async () => {
    const { app, auth } = await createTestApp();
    const { cookie } = await signUp(app);
    const sub = await userId(app, cookie);

    const res = await me(app, await accessToken(auth, { sub, aud: ['https://other.example'] }));

    expect(res.status).toBe(401);
  });

  it('FR-13 FR-19 rejects an expired token without falling back to the cookie', async () => {
    const { app, auth } = await createTestApp();
    const { cookie } = await signUp(app);
    const sub = await userId(app, cookie);
    const past = Math.floor(Date.now() / 1000) - 7200;

    const res = await me(
      app,
      await accessToken(auth, { sub, iat: past, exp: past + 3600 }),
      cookie,
    );

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('FR-13 rejects a token whose payload was changed after signing', async () => {
    const { app, auth } = await createTestApp();
    const { cookie: alice } = await signUp(app);
    const { cookie: bob } = await signUp(app);
    const token = await accessToken(auth, { sub: await userId(app, alice) });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        iss: `${API_URL}/auth`,
        aud: [API_URL],
        sub: await userId(app, bob),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');

    const res = await me(app, `${header}.${forged}.${signature}`);

    expect(res.status).toBe(401);
  });

  it('FR-13 does not treat a token without a subject as a user', async () => {
    const { app, auth } = await createTestApp();

    const res = await me(app, await accessToken(auth, {}));

    expect(res.status).toBe(401);
  });

  it('FR-13 keeps the device list for the account center session only', async () => {
    const { app, auth } = await createTestApp();
    const { cookie } = await signUp(app);
    const sub = await userId(app, cookie);

    const res = await app.request('/v1/sessions', {
      headers: { authorization: `Bearer ${await accessToken(auth, { sub })}` },
    });

    expect(res.status).toBe(401);
  });
});
