import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { en } from '../../src/mail/templates/en';
import { ACCOUNT_URL, createTestApp } from '../helpers/app';
import { newEmail, post, signIn, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { linkIn } from '../helpers/mailbox';

const NEW_PASSWORD = 'new-lanterns-on-the-stairs-7';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const { email, cookie } = await signUp(ctx.app, { locale: 'en' });
  await signIn(ctx.app, email);
  const requestReset = (address = email) =>
    post(ctx.app, '/auth/request-password-reset', { email: address });
  const resetToken = () => {
    const mail = ctx.mailbox.sent.filter((m) => m.subject === en.resetPassword.subject).at(-1);
    return linkIn(mail, ACCOUNT_URL).searchParams.get('token') ?? '';
  };
  const reset = (token: string) =>
    post(ctx.app, '/auth/reset-password', { token, newPassword: NEW_PASSWORD });
  const sessionCount = async () => {
    const rows = await ctx.db.execute(sql`select count(*)::int as n from "session"`);
    return (rows.rows[0] as { n: number }).n;
  };
  return { ...ctx, email, cookie, requestReset, resetToken, reset, sessionCount };
}

describe('password reset', () => {
  it('FR-5 FR-73 mails a reset link to the account center in the user locale', async () => {
    const { requestReset, mailbox, email } = await setup();
    const before = mailbox.sent.length;

    expect((await requestReset()).status).toBe(200);

    expect(mailbox.sent).toHaveLength(before + 1);
    const mail = mailbox.sent.at(-1);
    expect(mail?.to).toBe(email);
    expect(mail?.subject).toBe(en.resetPassword.subject);
    expect(linkIn(mail, ACCOUNT_URL).pathname).toBe('/en/reset-password');
  });

  it('FR-5 answers an unknown email the same way and sends nothing', async () => {
    const { requestReset, mailbox, email } = await setup();
    const known = await (await requestReset(email)).text();
    const sent = mailbox.sent.length;

    const unknown = await requestReset(newEmail());

    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toBe(known);
    expect(mailbox.sent).toHaveLength(sent);
  });

  it('FR-5 resetting ends every session and the new password signs in', async () => {
    const { app, email, requestReset, resetToken, reset, sessionCount } = await setup();
    expect(await sessionCount()).toBe(2);
    await requestReset();

    expect((await reset(resetToken())).status).toBe(200);

    expect(await sessionCount()).toBe(0);
    expect((await signIn(app, email)).res.status).toBe(401);
    expect((await signIn(app, email, NEW_PASSWORD)).res.status).toBe(200);
  });

  it('FR-5 rejects a token that was already used with 400', async () => {
    const { requestReset, resetToken, reset } = await setup();
    await requestReset();
    const token = resetToken();
    expect((await reset(token)).status).toBe(200);

    expect((await reset(token)).status).toBe(400);
  });

  it('FR-5 rejects a token older than one hour with 400', async () => {
    const { requestReset, resetToken, reset } = await setup();
    await requestReset();
    const token = resetToken();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1000);

    expect((await reset(token)).status).toBe(400);
  });
});
