import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { termsVersion } from '@stairno-account/contract';
import { createTestApp } from '../helpers/app';
import { signIn, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Attributes of one Set-Cookie header, lower-cased names, values as sent.
function parseCookie(header: string) {
  const [pair = '', ...attrs] = header.split(';').map((p) => p.trim());
  const name = pair.slice(0, pair.indexOf('='));
  const attributes = new Map(
    attrs.map((a) => {
      const i = a.indexOf('=');
      return i < 0 ? [a.toLowerCase(), ''] : [a.slice(0, i).toLowerCase(), a.slice(i + 1)];
    }),
  );
  return { name, attributes };
}

function sessionCookie(res: Response) {
  const header = res.headers.getSetCookie().find((c) => c.includes('session_token='));
  if (!header) throw new Error('no session cookie');
  return parseCookie(header);
}

describe('session cookie', () => {
  it('FR-10 is HttpOnly, Secure, SameSite=Lax and shared across stairno.com', async () => {
    const { app } = await createTestApp();
    const { email } = await signUp(app);

    const { name, attributes } = sessionCookie((await signIn(app, email)).res);

    expect(name).toBe('__Secure-stairno.session_token');
    expect(attributes.has('httponly')).toBe(true);
    expect(attributes.has('secure')).toBe(true);
    expect(attributes.get('samesite')?.toLowerCase()).toBe('lax');
    expect(attributes.get('domain')).toBe('stairno.com');
    expect(attributes.get('path')).toBe('/');
  });

  it('FR-10 stays host-only and not Secure for local http development', async () => {
    const { app } = await createTestApp(
      {},
      { apiUrl: 'http://localhost:8787', accountUrl: 'http://localhost:4321', cookieDomain: '' },
    );
    const res = await app.request('http://localhost:8787/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:4321' },
      body: JSON.stringify({
        name: 'Local',
        email: 'local@example.com',
        password: 'stairs-and-lanterns-42',
        termsVersion,
      }),
    });

    const { name, attributes } = sessionCookie(res);

    expect(name).toBe('stairno.session_token');
    expect(attributes.has('secure')).toBe(false);
    expect(attributes.has('domain')).toBe(false);
    expect(attributes.has('httponly')).toBe(true);
  });
});
