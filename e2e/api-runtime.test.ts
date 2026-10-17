// Day-one check (plan §5 risk 3): Better Auth + oauth-provider + Drizzle (neon-http) on workerd.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { termsVersion } from '@stairno-account/contract';
import { resetDatabase, startApiWorker } from './helpers';

const ORIGIN = 'http://localhost:4321';
let base: URL;
let dispose: () => Promise<void>;

beforeAll(async () => {
  await resetDatabase();
  const worker = await startApiWorker();
  base = worker.url;
  dispose = worker.dispose;
});

afterAll(async () => {
  await dispose?.();
});

function post(path: string, body: unknown, cookie?: string) {
  return fetch(new URL(path, base), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function sessionCookie(res: Response) {
  const line = res.headers.getSetCookie().find((c) => c.startsWith('stairno.session_token='));
  return line?.split(';')[0];
}

describe('API Worker on workerd', () => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'stairs-and-lanterns-42';

  it('FR-22 reaches the database through the Neon HTTP driver', async () => {
    const res = await fetch(new URL('/health', base));
    expect(res.status).toBe(200);
  });

  it('FR-1 signs up and gets a session, FR-23 the session names the user', async () => {
    const res = await post('/auth/sign-up/email', { name: 'E2E', email, password, termsVersion });
    expect(res.status).toBe(200);
    const cookie = sessionCookie(res);
    expect(cookie).toBeDefined();

    const session = await fetch(new URL('/auth/get-session', base), {
      headers: { cookie: cookie! },
    });
    const text = await session.text();
    expect(session.status, text).toBe(200);
    expect((JSON.parse(text) as { user: { email: string } }).user.email).toBe(email);
  });

  it('FR-3 signs in with the right password and gets the same error for a wrong one', async () => {
    const wrong = await post('/auth/sign-in/email', { email, password: 'wrong-password-123' });
    const unknown = await post('/auth/sign-in/email', {
      email: `nobody-${Date.now()}@example.com`,
      password,
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());

    const ok = await post('/auth/sign-in/email', { email, password });
    expect(ok.status).toBe(200);
    expect(sessionCookie(ok)).toBeDefined();
  });

  it('FR-4 signing out ends the session', async () => {
    const signIn = await post('/auth/sign-in/email', { email, password });
    const cookie = sessionCookie(signIn)!;
    expect((await post('/auth/sign-out', {}, cookie)).status).toBe(200);
    const session = await fetch(new URL('/auth/get-session', base), { headers: { cookie } });
    expect(await session.json()).toBeNull();
  });

  it('NFR-5 rejects a state-changing request from another origin', async () => {
    const res = await fetch(new URL('/auth/sign-in/email', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(403);
  });

  it('FR-14 serves the discovery document and JWKS', async () => {
    const discovery = (await (
      await fetch(new URL('/auth/.well-known/openid-configuration', base))
    ).json()) as { code_challenge_methods_supported: string[] };
    expect(discovery.code_challenge_methods_supported).toContain('S256');
    const jwks = (await (await fetch(new URL('/auth/jwks', base))).json()) as {
      keys: { alg: string }[];
    };
    expect(jwks.keys[0]?.alg).toBe('EdDSA');
  });
});
