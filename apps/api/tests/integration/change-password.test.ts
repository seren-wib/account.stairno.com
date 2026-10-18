import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../src/mail/templates/en';
import { ACCOUNT_URL, createTestApp } from '../helpers/app';
import { cookieFrom, PASSWORD, post, sessionUser, signIn, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { linkIn } from '../helpers/mailbox';

// FR-83: changing the password while signed in. The rules for the new one are FR-1's, and every
// other session ends whether or not the client asks for it.

const NEW_PASSWORD = 'quiet-landing-on-step-9';
const PWNED = 'password1234';

beforeEach(() => {
  stubPwnedPasswords([PWNED]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const { email, cookie: here } = await signUp(ctx.app, { locale: 'en' });
  const { cookie: elsewhere } = await signIn(ctx.app, email);
  const change = (body: Record<string, unknown>, cookie: string | null = here) =>
    post(ctx.app, '/auth/change-password', body, cookie ?? undefined);
  return { ...ctx, email, here, elsewhere, change };
}

describe('change password', () => {
  it('FR-83 takes the current password and a new one; only the new one signs in after', async () => {
    const { app, email, change } = await setup();

    const res = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect((await signIn(app, email)).res.status).toBe(401);
    expect((await signIn(app, email, NEW_PASSWORD)).res.status).toBe(200);
  });

  it('FR-83 ends every other session even when the client does not ask, and keeps this one', async () => {
    const { app, change, elsewhere } = await setup();

    const res = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(await sessionUser(app, elsewhere)).toBeNull();
    expect(await sessionUser(app, cookieFrom(res))).not.toBeNull();
  });

  it('FR-83 refuses a wrong current password with 400 and keeps the old one', async () => {
    const { app, email, change, elsewhere } = await setup();

    const res = await change({ currentPassword: 'not-the-password-1', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_PASSWORD');
    expect((await signIn(app, email)).res.status).toBe(200);
    expect(await sessionUser(app, elsewhere)).not.toBeNull();
  });

  it('FR-83 FR-1 refuses a breached or too short new password with 400', async () => {
    const { app, email, change } = await setup();

    const breached = await change({ currentPassword: PASSWORD, newPassword: PWNED });
    const short = await change({ currentPassword: PASSWORD, newPassword: 'short-7' });

    expect(breached.status).toBe(400);
    expect(((await breached.json()) as { code?: string }).code).toBe('PASSWORD_COMPROMISED');
    expect(short.status).toBe(400);
    expect(((await short.json()) as { code?: string }).code).toBe('PASSWORD_TOO_SHORT');
    expect((await signIn(app, email)).res.status).toBe(200);
  });

  it('FR-83 FR-72 FR-73 mails the owner that the password changed, with a way to reset it', async () => {
    const { change, mailbox, email } = await setup();
    const before = mailbox.sent.length;

    expect((await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(
      200,
    );

    expect(mailbox.sent).toHaveLength(before + 1);
    const mail = mailbox.sent.at(-1);
    expect(mail?.to).toBe(email);
    expect(mail?.subject).toBe(en.passwordChanged.subject);
    expect(linkIn(mail, ACCOUNT_URL).pathname).toBe('/en/forgot-password');
    expect(mail?.text).toContain('contact@stairno.com');
  });

  it('FR-83 mails nothing when the change is refused', async () => {
    const { change, mailbox } = await setup();
    const before = mailbox.sent.length;

    await change({ currentPassword: 'not-the-password-1', newPassword: NEW_PASSWORD });
    await change({ currentPassword: PASSWORD, newPassword: PWNED });

    expect(mailbox.sent).toHaveLength(before);
  });

  it('FR-83 needs a session', async () => {
    const { change } = await setup();
    const res = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, null);
    expect(res.status).toBe(401);
  });
});
