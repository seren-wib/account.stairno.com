import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { createFakeProvider, type FakeProvider } from '../../src/payments/fake';
import type { WebhookEvent } from '../../src/payments/provider';
import { API_URL, createTestApp } from '../helpers/app';
import { signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, registerSite, signInToSite, siteToken } from '../helpers/oidc';

// FR-49 to FR-52: PayPal for USD orders. The site asks for a PayPal order and sends the payer to
// its approval URL; back on the site, it asks the API to capture. PayPal is the fake (NFR-16).

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

const RETURN_URL = 'https://stairnolabs.com/checkout/done';

async function setup(overrides: Parameters<typeof createTestApp>[0] = {}) {
  const paypal = createFakeProvider();
  const ctx = await createTestApp({
    providers: { toss: createFakeProvider(), paypal },
    ...overrides,
  });
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
  const createOrder = async (currency = 'USD') => {
    const res = await ctx.app.request('/v1/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${siteBearer}`,
        'x-user-token': userBearer,
      },
      body: JSON.stringify({ sku: 'atlas-odyssey-desktop', currency, returnUrl: RETURN_URL }),
    });
    return ((await res.json()) as { order: { id: string } }).order.id;
  };
  const orderId = await createOrder();
  const call = (path: string, body: unknown, token = siteBearer) =>
    ctx.app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  const start = (id = orderId, token?: string) =>
    call('/v1/payments/paypal/orders', { orderId: id }, token);
  const capture = (id = orderId, token?: string) =>
    call('/v1/payments/paypal/capture', { orderId: id }, token);
  return {
    ...ctx,
    paypal,
    site,
    buyer,
    siteBearer,
    userBearer,
    orderId,
    createOrder,
    start,
    capture,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function state(db: Ctx['db']) {
  const all = async <T>(query: SQL) => ((await db.execute(query)) as { rows: T[] }).rows;
  return {
    orders: await all<{ status: string; provider_order_id: string | null }>(
      sql`select status, provider_order_id from "order" order by created_at`,
    ),
    payments: await all<{ status: string; provider: string; provider_payment_key: string }>(
      sql`select status, provider, provider_payment_key from payment`,
    ),
    entitlements: await all<{ status: string }>(sql`select status from entitlement`),
  };
}

const calls = (fake: FakeProvider, method: string) =>
  fake.calls.filter((call) => call.method === method);

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('POST /v1/payments/paypal/orders', () => {
  it('FR-49 creates a PayPal order for a pending USD order and keeps its id', async () => {
    const ctx = await setup();

    const res = await ctx.start();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orderId: ctx.orderId,
      paypalOrderId: `fake_order_${ctx.orderId}`,
      approvalUrl: `https://fake.invalid/approve/fake_order_${ctx.orderId}`,
    });
    expect(calls(ctx.paypal, 'createCheckout')).toEqual([
      {
        method: 'createCheckout',
        input: expect.objectContaining({
          order: { id: ctx.orderId, amount: 900, currency: 'USD' },
          returnUrl: RETURN_URL,
          cancelUrl: RETURN_URL,
        }),
      },
    ]);
    expect((await state(ctx.db)).orders).toEqual([
      { status: 'pending', provider_order_id: `fake_order_${ctx.orderId}` },
    ]);
  });

  it('FR-38 asking again answers with the same PayPal order', async () => {
    const ctx = await setup();
    const first = await (await ctx.start()).json();

    const again = await ctx.start();

    expect(await again.json()).toEqual(first);
  });

  it('DR-5 refuses a Toss order', async () => {
    const ctx = await setup();
    const krw = await ctx.createOrder('KRW');

    const res = await ctx.start(krw);

    expect(res.status).toBe(422);
    expect(calls(ctx.paypal, 'createCheckout')).toEqual([]);
  });

  it('FR-36 FR-40 refuses an order that is not pending, another site’s, or unknown', async () => {
    const ctx = await setup();
    const works = await registerSite(
      ctx,
      'Stairno Works',
      'https://stairnoworks.com/auth/callback',
    );
    const worksToken = await siteToken(ctx, works);

    const unknown = await ctx.start(crypto.randomUUID());
    const other = await ctx.start(ctx.orderId, worksToken);
    await ctx.db.execute(sql`update "order" set status = 'failed'`);
    const failed = await ctx.start();

    expect([unknown.status, other.status, failed.status]).toEqual([404, 404, 409]);
    expect(calls(ctx.paypal, 'createCheckout')).toEqual([]);
  });

  it('FR-49 answers 502 when PayPal cannot be reached', async () => {
    const ctx = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ctx.paypal.willThrow();

    const res = await ctx.start();

    expect(res.status).toBe(502);
    expect((await state(ctx.db)).orders).toEqual([{ status: 'pending', provider_order_id: null }]);
  });

  it('FR-42 SDD §8 answers 503 with payments off and 403 to a user', async () => {
    const ctx = await setup();
    const asUser = await ctx.start(ctx.orderId, ctx.userBearer);
    ctx.deps.paymentsMode = 'off';
    const off = await ctx.start();

    expect([asUser.status, off.status]).toEqual([403, 503]);
  });
});

describe('POST /v1/payments/paypal/capture', () => {
  async function started() {
    const ctx = await setup();
    await ctx.start();
    return ctx;
  }

  it('FR-49 FR-39 captures, fulfils the order and grants the product', async () => {
    const ctx = await started();

    const res = await ctx.capture();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      order: { id: ctx.orderId, status: 'fulfilled' },
      payment: { provider: 'paypal', status: 'done' },
    });
    expect(calls(ctx.paypal, 'confirm')).toEqual([
      {
        method: 'confirm',
        input: expect.objectContaining({
          providerPaymentKey: `fake_order_${ctx.orderId}`,
          amount: 900,
          currency: 'USD',
        }),
      },
    ]);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'fulfilled' }],
      payments: [{ status: 'done', provider: 'paypal' }],
      entitlements: [{ status: 'active' }],
    });
  });

  it('FR-50 FR-51 refunds a capture for another amount and fails the order', async () => {
    const ctx = await started();
    ctx.paypal.willApproveAmount(100);

    const res = await ctx.capture();

    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('amount_mismatch');
    expect(calls(ctx.paypal, 'cancel')).toHaveLength(1);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'failed' }],
      payments: [{ status: 'canceled' }],
      entitlements: [],
    });
  });

  it('FR-49 records a decline and fails the order', async () => {
    const ctx = await started();
    ctx.paypal.willDecline('INSTRUMENT_DECLINED');

    const res = await ctx.capture();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      order: { status: 'failed' },
      payment: { status: 'failed', failureReason: 'INSTRUMENT_DECLINED' },
    });
  });

  it('FR-49 answers 202 and writes nothing while the payer has not approved', async () => {
    const ctx = await started();
    ctx.paypal.willWaitForPayer();

    const res = await ctx.capture();

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ order: { status: 'pending' } });
    expect(await state(ctx.db)).toMatchObject({ orders: [{ status: 'pending' }], payments: [] });
  });

  it('FR-38 answers a second capture with the first result', async () => {
    const ctx = await started();
    const first = await (await ctx.capture()).json();

    const again = await ctx.capture();

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(calls(ctx.paypal, 'confirm')).toHaveLength(1);
  });

  it('FR-49 refuses to capture before a PayPal order exists', async () => {
    const ctx = await setup();

    const res = await ctx.capture();

    expect(res.status).toBe(409);
    expect(calls(ctx.paypal, 'confirm')).toEqual([]);
  });

  it('FR-36 refuses an order past its 30 minutes', async () => {
    const ctx = await started();
    await ctx.db.execute(sql`update "order" set expires_at = now() - interval '1 minute'`);

    const res = await ctx.capture();

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('invalid_transition');
    expect(calls(ctx.paypal, 'confirm')).toEqual([]);
  });
});

describe('POST /webhooks/paypal', () => {
  function event(
    ctx: Setup,
    status: WebhookEvent['status'],
    { id = 'WH-EVENT-1', type = 'PAYMENT.CAPTURE.COMPLETED', amount = 900 } = {},
  ): Omit<WebhookEvent, 'raw'> {
    const key = `fake_order_${ctx.orderId}`;
    return {
      eventId: id,
      eventType: type,
      providerPaymentKey: key,
      status,
      orderRef: ctx.orderId,
      payment: {
        status,
        providerPaymentKey: key,
        amount,
        currency: 'USD',
        methodSummary: 'PayPal',
        raw: {},
      },
    };
  }

  async function deliver(ctx: Setup, e: Omit<WebhookEvent, 'raw'>, signature?: string) {
    const req = ctx.paypal.webhookRequest(e, signature ? { signature } : {});
    return ctx.app.request('/webhooks/paypal', {
      method: 'POST',
      headers: req.headers,
      body: await req.text(),
    });
  }

  it('FR-52 FR-39 fulfils a pending order whose capture answer was lost', async () => {
    const ctx = await setup();
    await ctx.start();

    const res = await deliver(ctx, event(ctx, 'done'));

    expect(res.status).toBe(200);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'fulfilled' }],
      payments: [{ status: 'done', provider: 'paypal' }],
      entitlements: [{ status: 'active' }],
    });
  });

  it('FR-51 FR-61 refunds an order refunded at PayPal and revokes the product', async () => {
    const ctx = await setup();
    await ctx.start();
    await ctx.capture();

    const res = await deliver(
      ctx,
      event(ctx, 'canceled', { id: 'WH-EVENT-2', type: 'PAYMENT.CAPTURE.REFUNDED' }),
    );

    expect(res.status).toBe(200);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'refunded' }],
      payments: [{ status: 'canceled' }],
      entitlements: [{ status: 'revoked' }],
    });
  });

  it('FR-52 fails a pending order whose capture was denied', async () => {
    const ctx = await setup();
    await ctx.start();

    const res = await deliver(ctx, event(ctx, 'failed', { type: 'PAYMENT.CAPTURE.DENIED' }));

    expect(res.status).toBe(200);
    expect((await state(ctx.db)).orders).toMatchObject([{ status: 'failed' }]);
  });

  it('FR-52 answers 400 to a bad signature and changes nothing', async () => {
    const ctx = await setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await deliver(ctx, event(ctx, 'done'), 'forged');

    expect(res.status).toBe(400);
    expect((await state(ctx.db)).orders).toMatchObject([{ status: 'pending' }]);
  });

  it('FR-68 does not process the same PayPal event twice', async () => {
    const ctx = await setup();
    await ctx.start();
    await deliver(ctx, event(ctx, 'done'));
    const before = await state(ctx.db);

    const again = await deliver(ctx, event(ctx, 'done'));

    expect(again.status).toBe(200);
    expect(await state(ctx.db)).toEqual(before);
  });
});
