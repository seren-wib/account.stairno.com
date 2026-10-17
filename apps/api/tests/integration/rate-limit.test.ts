import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { newEmail, post, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const fromIp = (ip: string) => ({ 'cf-connecting-ip': ip });

async function statuses(times: number, send: () => Response | Promise<Response>) {
  const out: number[] = [];
  for (let i = 0; i < times; i++) out.push((await send()).status);
  return out;
}

describe('rate limits', () => {
  it('NFR-4 the 11th sign-in from one address within a minute is 429', async () => {
    const { app } = await createTestApp();
    const { email } = await signUp(app);
    const attempt = () =>
      post(
        app,
        '/auth/sign-in/email',
        { email, password: 'wrong-password-1' },
        undefined,
        fromIp('203.0.113.7'),
      );

    const seen = await statuses(11, attempt);

    expect(seen.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(seen[10]).toBe(429);
  });

  it('NFR-4 another address is not held back', async () => {
    const { app } = await createTestApp();
    const { email } = await signUp(app);
    await statuses(11, () =>
      post(
        app,
        '/auth/sign-in/email',
        { email, password: 'wrong-password-1' },
        undefined,
        fromIp('203.0.113.7'),
      ),
    );

    const other = await post(
      app,
      '/auth/sign-in/email',
      { email, password: 'wrong-password-1' },
      undefined,
      fromIp('198.51.100.9'),
    );

    expect(other.status).toBe(401);
  });

  it('NFR-4 the 11th sign-up from one address within a minute is 429', async () => {
    const { app } = await createTestApp();

    const seen = await statuses(11, async () => (await signUp(app, {}, fromIp('203.0.113.8'))).res);

    expect(seen.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(seen[10]).toBe(429);
  });

  it('NFR-4 the 4th password reset request within a minute is 429', async () => {
    const { app } = await createTestApp();
    const request = () =>
      post(
        app,
        '/auth/request-password-reset',
        { email: newEmail() },
        undefined,
        fromIp('203.0.113.9'),
      );

    expect(await statuses(4, request)).toEqual([200, 200, 200, 429]);
  });

  it('FR-74 a second verification mail within a minute is 429', async () => {
    const { app } = await createTestApp();
    const { email } = await signUp(app);
    const resend = () =>
      post(app, '/auth/send-verification-email', { email }, undefined, fromIp('203.0.113.10'));

    expect(await statuses(2, resend)).toEqual([200, 429]);
  });

  it('NFR-4 leaves get-session alone for the account center server', async () => {
    const { app } = await createTestApp();
    const { cookie } = await signUp(app);

    const seen = await statuses(30, () =>
      app.request('/auth/get-session', { headers: { cookie, ...fromIp('203.0.113.11') } }),
    );

    expect(seen.every((s) => s === 200)).toBe(true);
  });
});
