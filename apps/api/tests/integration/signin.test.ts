import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { newEmail, signIn, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /auth/sign-in/email', () => {
  it('FR-3 signs in with the right email and password', async () => {
    const { app } = await createTestApp();
    const { email } = await signUp(app);
    const { res, cookie } = await signIn(app, email);
    expect(res.status).toBe(200);
    expect(cookie).toContain('stairno.session_token=');
  });

  it('FR-3 returns the same status and body for an unknown email and a wrong password', async () => {
    const { app } = await createTestApp();
    const { email } = await signUp(app);

    const unknown = (await signIn(app, newEmail())).res;
    const wrong = (await signIn(app, email, 'not-the-password-1')).res;

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(unknown.status);
    expect(await wrong.text()).toBe(await unknown.text());
    expect(wrong.headers.getSetCookie()).toEqual([]);
  });
});
