import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { createFakeProvider, type FakeProvider } from '../../src/payments/fake';
import { API_URL, createTestApp } from '../helpers/app';
import { signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, registerSite, signInToSite, siteToken } from '../helpers/oidc';

// FR-43, FR-44, FR-37, FR-38, FR-39: the site sends what Toss's success redirect gave it, and the
// API confirms the payment with Toss, checks the amount and fulfils the order. Toss is the fake
// provider here (NFR-16).

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

const RETURN_URL = 'https://stairnolabs.com/checkout/done';
const PAYMENT_KEY = 'tgen_20261018_abc';

async function setup(overrides: Parameters<typeof createTestApp>[0] = {}) {
  const toss = createFakeProvider();
  const ctx = await createTestApp({ providers: { toss }, ...overrides });
  const site = await registerLabs(ctx);
  const buyer = await signUp(ctx.app);
  await ctx.db.execute(sql`update "user" set email_verified = true where email = ${buyer.email}`);
  await addProduct(ctx.db, {
    sku: 'atlas-odyssey-desktop',
    clientId: site.clientId,
    nameKo: '아틀라스 오디세이 데스크톱',
    nameEn: 'Atlas Odyssey Desktop',
    kind: 'one_time',
    prices: [
      { currency: 'KRW', amount: 12000 },
      { currency: 'USD', amount: 900 },
    ],
    downloadKey: 'atlas-odyssey/1.0.0/setup.exe',
  });
  const siteBearer = await siteToken(ctx, site);
  const userBearer = (await signInToSite(ctx, site, buyer.cookie, { resource: API_URL }))
    .access_token;
  return { ...ctx, toss, site, buyer, siteBearer, userBearer };
}

async function createOrder(ctx: Awaited<ReturnType<typeof setup>>, currency = 'KRW') {
  const res = await ctx.app.request('/v1/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ctx.siteBearer}`,
      'x-user-token': ctx.userBearer,
    },
    body: JSON.stringify({ sku: 'atlas-odyssey-desktop', currency, returnUrl: RETURN_URL }),
  });
  return ((await res.json()) as { order: { id: string; amount: number } }).order;
}

function confirm(app: Ctx['app'], token: string, body: Record<string, unknown>) {
  return app.request('/v1/payments/toss/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function withOrder(overrides: Parameters<typeof createTestApp>[0] = {}) {
  const ctx = await setup(overrides);
  const order = await createOrder(ctx);
  const send = (body: Record<string, unknown> = {}) =>
    confirm(ctx.app, ctx.siteBearer, {
      paymentKey: PAYMENT_KEY,
      orderId: order.id,
      amount: order.amount,
      ...body,
    });
  return { ...ctx, order, send };
}

async function state(db: Ctx['db']) {
  const one = async <T>(query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as { rows: T[] }).rows;
  return {
    orders: await one<{ status: string }>(sql`select status from "order"`),
    payments: await one<{ status: string; provider: string; provider_payment_key: string }>(
      sql`select status, provider, provider_payment_key from payment`,
    ),
    entitlements: await one<{ status: string; downloadable: boolean }>(
      sql`select status, downloadable from entitlement`,
    ),
  };
}

const calls = (fake: FakeProvider, method: string) =>
  fake.calls.filter((call) => call.method === method);

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('POST /v1/payments/toss/confirm', () => {
  it('FR-43 FR-39 confirms with Toss, fulfils the order and grants the product', async () => {
    const { db, toss, order, send } = await withOrder();

    const res = await send();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: Record<string, unknown>; payment: unknown };
    expect(body.order).toMatchObject({
      id: order.id,
      status: 'fulfilled',
      paidAt: expect.any(String),
      fulfilledAt: expect.any(String),
    });
    expect(body.payment).toEqual({
      provider: 'toss',
      status: 'done',
      paymentKey: PAYMENT_KEY,
      methodSummary: 'Fake Card ****4242',
      receiptUrl: `https://fake.invalid/receipts/${PAYMENT_KEY}`,
    });
    expect(calls(toss, 'confirm')).toEqual([
      {
        method: 'confirm',
        input: expect.objectContaining({
          providerPaymentKey: PAYMENT_KEY,
          amount: 12000,
          currency: 'KRW',
        }),
      },
    ]);
    expect(await state(db)).toEqual({
      orders: [{ status: 'fulfilled' }],
      payments: [{ status: 'done', provider: 'toss', provider_payment_key: PAYMENT_KEY }],
      entitlements: [{ status: 'active', downloadable: true }],
    });
  });

  it('FR-44 refuses an amount that is not the order’s before asking Toss', async () => {
    const { db, toss, send } = await withOrder();

    const res = await send({ amount: 1000 });

    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('amount_mismatch');
    expect(calls(toss, 'confirm')).toEqual([]);
    expect((await state(db)).orders).toEqual([{ status: 'failed' }]);
  });

  it('FR-37 cancels a payment Toss approved for another amount', async () => {
    const { db, toss, send } = await withOrder();
    toss.willApproveAmount(1000);

    const res = await send();

    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('amount_mismatch');
    expect(calls(toss, 'cancel')).toEqual([
      {
        method: 'cancel',
        input: { providerPaymentKey: PAYMENT_KEY, reason: 'Amount differs from the order.' },
      },
    ]);
    expect(await state(db)).toEqual({
      orders: [{ status: 'failed' }],
      payments: [{ status: 'canceled', provider: 'toss', provider_payment_key: PAYMENT_KEY }],
      entitlements: [],
    });
  });

  it('FR-37 NFR-21 keeps the record and logs the order when that cancel fails too', async () => {
    const { db, toss, buyer, order, send } = await withOrder();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    toss.willApproveAmount(1000);
    toss.willThrow();

    const res = await send();

    expect(res.status).toBe(502);
    expect(await errorCode(res)).toBe('provider_error');
    // The money is still held at Toss: the payment row says so for the operator's refund.
    expect(await state(db)).toEqual({
      orders: [{ status: 'failed' }],
      payments: [{ status: 'done', provider: 'toss', provider_payment_key: PAYMENT_KEY }],
      entitlements: [],
    });
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain(order.id);
    expect(logged).not.toContain(buyer.email);
  });

  it('FR-43 records a decline and fails the order', async () => {
    const { db, send, toss } = await withOrder();
    toss.willDecline('REJECT_CARD_PAYMENT');

    const res = await send();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      order: { status: 'failed' },
      payment: { status: 'failed', failureReason: 'REJECT_CARD_PAYMENT' },
    });
    expect((await state(db)).payments).toEqual([
      { status: 'failed', provider: 'toss', provider_payment_key: PAYMENT_KEY },
    ]);
  });

  it('FR-43 answers 502 and leaves the order pending when Toss cannot be reached', async () => {
    const { db, send, toss } = await withOrder();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    toss.willThrow();

    const res = await send();

    expect(res.status).toBe(502);
    expect(await errorCode(res)).toBe('provider_error');
    expect(await state(db)).toEqual({
      orders: [{ status: 'pending' }],
      payments: [],
      entitlements: [],
    });
  });

  it('FR-38 answers the same payment key again with the first result', async () => {
    const { db, toss, send } = await withOrder();

    const first = await (await send()).json();
    const again = await send();

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(calls(toss, 'confirm')).toHaveLength(1);
    expect((await state(db)).payments).toHaveLength(1);
  });

  it('FR-38 two confirms at once give one payment and the same answer', async () => {
    const { db, send } = await withOrder();

    const [a, b] = await Promise.all([send(), send()]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    expect((await state(db)).payments).toHaveLength(1);
    expect((await state(db)).entitlements).toHaveLength(1);
  });

  it('FR-36 refuses an order that is no longer pending', async () => {
    const { db, toss, send } = await withOrder();
    await db.execute(sql`update "order" set status = 'failed'`);

    const res = await send();

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('invalid_transition');
    expect(calls(toss, 'confirm')).toEqual([]);
  });

  it('FR-36 expires an order past its 30 minutes instead of confirming it', async () => {
    const { db, toss, send } = await withOrder();
    await db.execute(sql`update "order" set expires_at = now() - interval '1 minute'`);

    const res = await send();

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('invalid_transition');
    expect(calls(toss, 'confirm')).toEqual([]);
    expect((await state(db)).orders).toEqual([{ status: 'expired' }]);
  });

  it('FR-36 FR-37 gives the money back when the order closes while Toss approves', async () => {
    const slow = createFakeProvider({ delayMs: 300 });
    const { db, send } = await withOrder({ providers: { toss: slow } });

    const pending = send();
    while (calls(slow, 'confirm').length === 0) await new Promise((r) => setTimeout(r, 5));
    await db.execute(sql`update "order" set status = 'expired'`);
    const res = await pending;

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('invalid_transition');
    expect(calls(slow, 'cancel')).toHaveLength(1);
    expect((await state(db)).payments).toEqual([]);
  });

  it('FR-40 answers 404 for another site’s order or an unknown one', async () => {
    const ctx = await withOrder();
    const works = await registerSite(
      ctx,
      'Stairno Works',
      'https://stairnoworks.com/auth/callback',
    );

    const other = await confirm(ctx.app, await siteToken(ctx, works), {
      paymentKey: PAYMENT_KEY,
      orderId: ctx.order.id,
      amount: 12000,
    });
    const unknown = await ctx.send({ orderId: crypto.randomUUID() });

    expect([other.status, unknown.status]).toEqual([404, 404]);
    expect(calls(ctx.toss, 'confirm')).toEqual([]);
  });

  it('DR-5 refuses a PayPal order', async () => {
    const ctx = await setup();
    const usd = await createOrder(ctx, 'USD');

    const res = await confirm(ctx.app, ctx.siteBearer, {
      paymentKey: PAYMENT_KEY,
      orderId: usd.id,
      amount: usd.amount,
    });

    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('validation_failed');
  });

  it('FR-24 answers 422 for a body that is not a confirm', async () => {
    const { send } = await withOrder();

    const res = await send({ paymentKey: '' });

    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('validation_failed');
  });

  it('FR-42 answers 503 payments_off when payments are off', async () => {
    const ctx = await setup({ paymentsMode: 'off' });
    const [row] = (
      (await ctx.db.execute(sql`
        insert into "order" (user_id, client_id, product_id, currency, amount, status, provider,
                             return_url, expires_at)
        select u.id, ${ctx.site.clientId}, p.id, 'KRW', 12000, 'pending', 'toss', ${RETURN_URL},
               now() + interval '30 minutes'
        from product p, "user" u where u.email = ${ctx.buyer.email}
        returning id`)) as { rows: { id: string }[] }
    ).rows;

    const res = await confirm(ctx.app, ctx.siteBearer, {
      paymentKey: PAYMENT_KEY,
      orderId: row!.id,
      amount: 12000,
    });

    expect(res.status).toBe(503);
    expect(calls(ctx.toss, 'confirm')).toEqual([]);
  });

  it('SDD §8 is for the site, not the user', async () => {
    const { app, buyer, userBearer, order } = await withOrder();
    const body = { paymentKey: PAYMENT_KEY, orderId: order.id, amount: order.amount };

    const withUserToken = await confirm(app, userBearer, body);
    const withCookie = await app.request('/v1/payments/toss/confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: buyer.cookie,
        origin: 'https://account.stairno.com',
      },
      body: JSON.stringify(body),
    });

    expect([withUserToken.status, withCookie.status]).toEqual([403, 403]);
  });
});
