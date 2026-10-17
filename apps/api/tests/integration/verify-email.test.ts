import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { en } from '../../src/mail/templates/en';
import { ko } from '../../src/mail/templates/ko';
import { ACCOUNT_URL, createTestApp } from '../helpers/app';
import { stubPwnedPasswords } from '../helpers/hibp';
import { linkIn } from '../helpers/mailbox';

const PASSWORD = 'stairs-and-lanterns-42';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const email = `user-${crypto.randomUUID()}@example.com`;
  const signUp = (extra: Record<string, unknown> = {}) =>
    ctx.app.request('/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ACCOUNT_URL },
      body: JSON.stringify({ name: 'Test User', email, password: PASSWORD, ...extra }),
    });
  const emailVerified = async () => {
    const rows = await ctx.db.execute(
      sql`select email_verified as v from "user" where email = ${email}`,
    );
    return (rows.rows[0] as { v: boolean }).v;
  };
  return { ...ctx, email, signUp, emailVerified };
}

describe('verification mail', () => {
  it('FR-2 FR-73 sends one verification mail in the user locale right after sign-up', async () => {
    const { signUp, mailbox, email } = await setup();
    expect((await signUp({ locale: 'en' })).status).toBe(200);

    expect(mailbox.sent).toHaveLength(1);
    const [mail] = mailbox.sent;
    expect(mail?.to).toBe(email);
    expect(mail?.subject).toBe(en.verifyEmail.subject);
    const link = linkIn(mail, ACCOUNT_URL);
    expect(link.pathname).toBe('/en/verify-email');
    expect(link.searchParams.get('token')).toBeTruthy();
  });

  it('FR-2 sends the mail in ko when sign-up names no locale', async () => {
    const { signUp, mailbox } = await setup();
    await signUp();
    expect(mailbox.sent[0]?.subject).toBe(ko.verifyEmail.subject);
    expect(linkIn(mailbox.sent[0], ACCOUNT_URL).pathname).toBe('/ko/verify-email');
  });

  it('FR-2 marks the email verified with the token from the mail', async () => {
    const { app, signUp, mailbox, emailVerified } = await setup();
    await signUp();
    expect(await emailVerified()).toBe(false);

    const token = linkIn(mailbox.sent[0], ACCOUNT_URL).searchParams.get('token') ?? '';
    const res = await app.request(`/auth/verify-email?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(await emailVerified()).toBe(true);
  });

  it('FR-2 rejects a forged verification token', async () => {
    const { app, signUp, emailVerified } = await setup();
    await signUp();
    const res = await app.request('/auth/verify-email?token=not-a-real-token');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await emailVerified()).toBe(false);
  });

  it('FR-2 signs in before the email is verified', async () => {
    const { app, signUp, email } = await setup();
    await signUp();
    const res = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ACCOUNT_URL },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { emailVerified: boolean } };
    expect(body.user.emailVerified).toBe(false);
  });
});
