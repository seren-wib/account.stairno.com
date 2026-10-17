import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../src/mail/templates/en';
import { ACCOUNT_URL, createTestApp } from '../helpers/app';
import { get, newEmail, post, sessionUser, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { linkIn } from '../helpers/mailbox';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const { email, cookie } = await signUp(ctx.app, { locale: 'en' });
  return { ...ctx, email, cookie };
}

describe('profile', () => {
  it('FR-6 changes the name and the language', async () => {
    const { app, cookie } = await setup();

    const res = await post(app, '/auth/update-user', { name: 'New Name', locale: 'ko' }, cookie);

    expect(res.status).toBe(200);
    const user = await sessionUser(app, cookie);
    expect(user?.name).toBe('New Name');
    expect(user?.locale).toBe('ko');
  });

  it('FR-6 FR-78 rejects a language other than ko and en', async () => {
    const { app, cookie } = await setup();

    const res = await post(app, '/auth/update-user', { locale: 'fr' }, cookie);

    expect(res.status).toBe(400);
    expect((await sessionUser(app, cookie))?.locale).toBe('en');
  });

  it('FR-78 rejects a language other than ko and en on sign-up', async () => {
    const { app } = await createTestApp();
    expect((await signUp(app, { locale: 'fr' })).res.status).toBe(400);
  });

  it('FR-6 FR-73 keeps the old email until the new address is verified', async () => {
    const { app, cookie, email, mailbox } = await setup();
    const next = newEmail();

    expect((await post(app, '/auth/change-email', { newEmail: next }, cookie)).status).toBe(200);

    const mail = mailbox.sent.at(-1);
    expect(mail?.to).toBe(next);
    expect(mail?.subject).toBe(en.changeEmail.subject);
    const link = linkIn(mail, ACCOUNT_URL);
    expect(link.pathname).toBe('/en/verify-email');
    expect((await sessionUser(app, cookie))?.email).toBe(email);

    const token = link.searchParams.get('token') ?? '';
    const res = await get(app, `/auth/verify-email?token=${encodeURIComponent(token)}`, cookie);
    expect(res.status).toBe(200);
    const user = await sessionUser(app, cookie);
    expect(user?.email).toBe(next);
    expect(user?.emailVerified).toBe(true);
  });

  it('FR-6 changing to an address that has an account sends nothing and changes nothing', async () => {
    const { app, cookie, email, mailbox } = await setup();
    const { email: taken } = await signUp(app);
    const sent = mailbox.sent.length;

    expect((await post(app, '/auth/change-email', { newEmail: taken }, cookie)).status).toBe(200);

    expect(mailbox.sent).toHaveLength(sent);
    expect((await sessionUser(app, cookie))?.email).toBe(email);
  });
});
