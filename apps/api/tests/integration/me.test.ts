import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /v1/me', () => {
  it('FR-23 NFR-9 returns only id, email, emailVerified, name, locale and createdAt', async () => {
    const { app } = await createTestApp();
    const { email, cookie } = await signUp(app, { locale: 'en' });

    const res = await get(app, '/v1/me', cookie);

    expect(res.status).toBe(200);
    const me = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(me).sort()).toEqual(
      ['createdAt', 'email', 'emailVerified', 'id', 'locale', 'name'].sort(),
    );
    expect(me).toMatchObject({ email, emailVerified: false, name: 'Test User', locale: 'en' });
    expect(me.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(String(me.createdAt)))).toBe(false);
    expect(String(me.createdAt)).toMatch(/Z$/);
  });

  it('FR-23 FR-24 answers 401 in the error format without a session', async () => {
    const { app } = await createTestApp();

    const res = await app.request('/v1/me');

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });
});
