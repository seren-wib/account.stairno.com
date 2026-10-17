import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestApp } from '../helpers/app';
import { PASSWORD, post, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mailLog(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const rows = await db.execute(
    sql`select user_id, template, locale, "to", status, provider_id, error from mail_log`,
  );
  return rows.rows as Record<string, string | null>[];
}

describe('mail log', () => {
  it('FR-74 records a sent mail', async () => {
    const { app, db } = await createTestApp();
    const { email } = await signUp(app, { locale: 'en' });

    const [row] = await mailLog(db);

    expect(row).toMatchObject({
      template: 'verifyEmail',
      locale: 'en',
      to: email,
      status: 'sent',
      error: null,
    });
    expect(row?.user_id).toBeTruthy();
  });

  it('FR-74 NFR-21 a failing mailer does not fail sign-up and the failure is recorded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, db, mailbox } = await createTestApp();
    vi.spyOn(mailbox, 'send').mockRejectedValue(new Error('Resend responded 503'));

    const { res, email } = await signUp(app);

    expect(res.status).toBe(200);
    const [row] = await mailLog(db);
    expect(row).toMatchObject({ template: 'verifyEmail', status: 'failed', to: email });
    expect(row?.error).toContain('503');
    expect(JSON.stringify(error.mock.calls)).not.toContain(email);
  });

  it('FR-8 FR-74 deleting the account removes its mail log', async () => {
    const { app, db } = await createTestApp();
    const { cookie } = await signUp(app);
    expect(await mailLog(db)).toHaveLength(1);

    await post(app, '/auth/delete-user', { password: PASSWORD }, cookie);

    expect(await mailLog(db)).toHaveLength(0);
  });
});
