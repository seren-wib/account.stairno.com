import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_URL, HUB_URL, createTestApp } from '../helpers/app';
import { post, sessionUser, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs } from '../helpers/oidc';

const LABS_ORIGIN = 'https://stairnolabs.com';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  await registerLabs(ctx);
  const preflight = (path: string, origin: string, method = 'GET') =>
    ctx.app.request(path, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': method,
        'access-control-request-headers': 'content-type',
      },
    });
  return { ...ctx, preflight };
}

describe('CORS', () => {
  it('FR-26 lets the account center call /v1 and /auth with credentials', async () => {
    const { preflight } = await setup();

    for (const path of ['/v1/me', '/auth/sign-in/email']) {
      const res = await preflight(path, ACCOUNT_URL, 'POST');
      expect(res.headers.get('access-control-allow-origin')).toBe(ACCOUNT_URL);
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    }
  });

  it.each(['GET', 'POST', 'PATCH', 'DELETE'])(
    'FR-26 FR-53 allows %s, a method the account center sends to /v1',
    async (method) => {
      const { preflight } = await setup();

      const res = await preflight('/v1/payment-methods/x/default', ACCOUNT_URL, method);

      expect(res.headers.get('access-control-allow-methods')?.split(',')).toContain(method);
    },
  );

  it('FR-26 lets a registered site call /v1', async () => {
    const { preflight } = await setup();

    const res = await preflight('/v1/me', LABS_ORIGIN);

    expect(res.headers.get('access-control-allow-origin')).toBe(LABS_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('FR-26 keeps registered sites away from /auth', async () => {
    const { preflight } = await setup();

    const res = await preflight('/auth/sign-in/email', LABS_ORIGIN, 'POST');

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each(['https://evil.example', 'http://account.stairno.com'])(
    'FR-26 gives %s no CORS headers',
    async (origin) => {
      const { preflight } = await setup();

      const res = await preflight('/v1/me', origin);

      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    },
  );

  it('FR-26 marks the actual response for the account center', async () => {
    const { app } = await setup();
    const { cookie } = await signUp(app);

    const res = await app.request('/v1/me', { headers: { cookie, origin: ACCOUNT_URL } });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ACCOUNT_URL);
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it.each([
    ['/auth/get-session', 'GET'],
    ['/auth/sign-out', 'POST'],
  ])('FR-80 lets the hub call %s with credentials', async (path, method) => {
    const { preflight } = await setup();

    const res = await preflight(path, HUB_URL, method);

    expect(res.headers.get('access-control-allow-origin')).toBe(HUB_URL);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it.each([
    ['/auth/sign-in/email', 'POST'],
    ['/auth/sign-up/email', 'POST'],
    ['/v1/me', 'GET'],
  ])('FR-80 keeps the hub away from %s', async (path, method) => {
    const { preflight } = await setup();

    const res = await preflight(path, HUB_URL, method);

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('FR-80 accepts a sign-out posted from the hub and ends the session', async () => {
    const { app } = await setup();
    const { cookie } = await signUp(app);

    const res = await post(app, '/auth/sign-out', {}, cookie, { origin: HUB_URL });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(HUB_URL);
    expect(await sessionUser(app, cookie)).toBeNull();
  });
});
