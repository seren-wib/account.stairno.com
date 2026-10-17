import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestApp } from '../helpers/app';
import { sessionUser, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  stubPwnedPasswords();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const { cookie } = await signUp(ctx.app);
  // Epoch reads Better Auth's UTC timestamps the same way in any machine time zone.
  const expiresAt = async () => {
    const rows = await ctx.db.execute(
      sql`select extract(epoch from expires_at) * 1000 as ms from "session"`,
    );
    return Number((rows.rows[0] as { ms: string | number }).ms);
  };
  return { ...ctx, cookie, expiresAt };
}

describe('session lifetime', () => {
  it('FR-11 starts a session that lasts 30 days', async () => {
    const { expiresAt } = await setup();
    expect(await expiresAt()).toBe(Date.now() + 30 * DAY);
  });

  it('FR-11 does not extend a session used again within a day', async () => {
    const { app, cookie, expiresAt } = await setup();
    const first = await expiresAt();

    vi.setSystemTime(Date.now() + 12 * 60 * 60 * 1000);
    expect(await sessionUser(app, cookie)).not.toBeNull();

    expect(await expiresAt()).toBe(first);
  });

  it('FR-11 extends the session to 30 days from use after a day', async () => {
    const { app, cookie, expiresAt } = await setup();

    vi.setSystemTime(Date.now() + 2 * DAY);
    expect(await sessionUser(app, cookie)).not.toBeNull();

    expect(await expiresAt()).toBe(Date.now() + 30 * DAY);
  });

  it('FR-11 ends a session unused for more than 30 days', async () => {
    const { app, cookie } = await setup();

    vi.setSystemTime(Date.now() + 30 * DAY + 1000);

    expect(await sessionUser(app, cookie)).toBeNull();
  });
});
