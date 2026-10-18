import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createFakeProvider } from '../../src/payments/fake';
import { ACCOUNT_URL, createTestApp } from '../helpers/app';
import { PASSWORD, get, post, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

// FR-8: deleting the account removes its cards, and their billing keys at Toss too. Once the user
// row is gone nobody could remove a billing key any more, so Toss goes first, and a Toss that
// cannot be reached stops the deletion until it can.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const toss = createFakeProvider();
  const ctx = await createTestApp({ providers: { toss } });
  const buyer = await signUp(ctx.app);
  await ctx.db.execute(sql`update "user" set email_verified = true where email = ${buyer.email}`);
  const addCard = async (authKey: string) => {
    const { customerKey } = (await (
      await get(ctx.app, '/v1/payment-methods', buyer.cookie)
    ).json()) as {
      customerKey: string;
    };
    await ctx.app.request('/v1/payment-methods/toss', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: buyer.cookie, origin: ACCOUNT_URL },
      body: JSON.stringify({ authKey, customerKey }),
    });
  };
  const deleteAccount = () =>
    post(ctx.app, '/auth/delete-user', { password: PASSWORD }, buyer.cookie);
  const count = async (query: ReturnType<typeof sql>) =>
    ((await ctx.db.execute(query)) as { rows: { n: number }[] }).rows[0]!.n;
  return { ...ctx, toss, buyer, addCard, deleteAccount, count };
}

const deleted = (toss: ReturnType<typeof createFakeProvider>) =>
  toss.calls.filter((call) => call.method === 'deleteBillingKey').map((call) => call.input);

describe('deleting an account with cards', () => {
  it('FR-8 FR-53 removes every live card’s billing key at Toss, then the account', async () => {
    const ctx = await setup();
    await ctx.addCard('auth_1');
    await ctx.addCard('auth_2');

    const res = await ctx.deleteAccount();

    expect(res.status).toBe(200);
    expect(deleted(ctx.toss).sort()).toEqual(['fake_billing_1', 'fake_billing_2']);
    expect(await ctx.count(sql`select count(*)::int as n from "user"`)).toBe(0);
    expect(await ctx.count(sql`select count(*)::int as n from payment_method`)).toBe(0);
  });

  it('FR-8 does not ask Toss again about a card already removed', async () => {
    const ctx = await setup();
    await ctx.addCard('auth_1');
    const [card] = (
      (await ctx.db.execute(sql`select id from payment_method`)) as { rows: { id: string }[] }
    ).rows;
    await ctx.app.request(`/v1/payment-methods/${card!.id}`, {
      method: 'DELETE',
      headers: { cookie: ctx.buyer.cookie, origin: ACCOUNT_URL },
    });

    await ctx.deleteAccount();

    expect(deleted(ctx.toss)).toEqual(['fake_billing_1']);
  });

  it('FR-8 refuses the deletion while Toss cannot be reached, and it goes through on the next try', async () => {
    const ctx = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await ctx.addCard('auth_1');
    ctx.toss.willThrow();

    const refused = await ctx.deleteAccount();

    expect(refused.status).toBe(502);
    expect(await ctx.count(sql`select count(*)::int as n from "user"`)).toBe(1);
    expect(
      await ctx.count(sql`select count(*)::int as n from payment_method where deleted_at is null`),
    ).toBe(1);

    const retried = await ctx.deleteAccount();

    expect(retried.status).toBe(200);
    expect(await ctx.count(sql`select count(*)::int as n from "user"`)).toBe(0);
  });

  it('FR-8 NFR-21 does not let a billing key it can no longer read block the deletion', async () => {
    const ctx = await setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ctx.addCard('auth_1');
    await ctx.db.execute(sql`update payment_method set billing_key = 'v1.broken.value'`);
    const [card] = (
      (await ctx.db.execute(sql`select id from payment_method`)) as { rows: { id: string }[] }
    ).rows;

    const res = await ctx.deleteAccount();

    expect(res.status).toBe(200);
    expect(deleted(ctx.toss)).toEqual([]);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain(card!.id);
    expect(logged).not.toContain(ctx.buyer.email);
  });

  it('FR-8 deletes an account without cards as before', async () => {
    const ctx = await setup();

    expect((await ctx.deleteAccount()).status).toBe(200);
    expect(deleted(ctx.toss)).toEqual([]);
  });
});
