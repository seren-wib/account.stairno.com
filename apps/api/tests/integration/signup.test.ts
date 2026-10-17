import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { ACCOUNT_URL, createTestApp } from '../helpers/app';
import { stubPwnedPasswords } from '../helpers/hibp';

const PWNED = 'password1234';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function signUp(password: string, email = `user-${crypto.randomUUID()}@example.com`) {
  const { app, db } = await createTestApp();
  const res = await app.request('/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ACCOUNT_URL },
    body: JSON.stringify({ name: 'Test User', email, password }),
  });
  const users = await db.execute(sql`select count(*)::int as n from "user"`);
  return { res, userCount: (users.rows[0] as { n: number }).n };
}

describe('POST /auth/sign-up/email', () => {
  it('FR-1 signs up with email, password and name and starts a session', async () => {
    stubPwnedPasswords([PWNED]);
    const { res, userCount } = await signUp('stairs-and-lanterns-42');
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.includes('stairno.session_token='))).toBe(true);
    expect(userCount).toBe(1);
  });

  it('FR-1 accepts exactly 8 and exactly 128 characters', async () => {
    stubPwnedPasswords();
    expect((await signUp('a'.repeat(4) + 'B7c!')).res.status).toBe(200);
    expect((await signUp('x'.repeat(127) + '9')).res.status).toBe(200);
  });

  it('FR-1 rejects a 7-character password with 400 and creates no user', async () => {
    stubPwnedPasswords();
    const { res, userCount } = await signUp('Ab3$efg');
    expect(res.status).toBe(400);
    expect(userCount).toBe(0);
  });

  it('FR-1 rejects a 129-character password with 400 and creates no user', async () => {
    stubPwnedPasswords();
    const { res, userCount } = await signUp('x'.repeat(129));
    expect(res.status).toBe(400);
    expect(userCount).toBe(0);
  });

  it('FR-1 rejects a password found in Have I Been Pwned with 400 and creates no user', async () => {
    const hibp = stubPwnedPasswords([PWNED]);
    const { res, userCount } = await signUp(PWNED);
    expect(res.status).toBe(400);
    expect(hibp.calls).toHaveLength(1);
    expect(userCount).toBe(0);
  });
});
