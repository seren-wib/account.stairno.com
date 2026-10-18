import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { createFakeProvider, type FakeProvider } from '../../src/payments/fake';
import type { WebhookEvent } from '../../src/payments/provider';
import { API_URL, createTestApp } from '../helpers/app';
import { signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, siteToken } from '../helpers/oidc';

// FR-48, FR-67 to FR-70: Toss tells us a payment changed. The adapter has already read the payment
// back from Toss (the fake stands in, NFR-16); the route keeps each event once and brings the order
// in step with what Toss says.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

const RETURN_URL = 'https://stairnolabs.com/checkout/done';
const KEY = 'tgen_20261018_abc';
const CREATED_AT = '2026-10-18T10:00:00.000000';

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
    prices: [{ currency: 'KRW', amount: 12000 }],
    downloadKey: 'atlas-odyssey/1.0.0/setup.exe',
  });
  const siteBearer = await siteToken(ctx, site);
  const userBearer = (await signInToSite(ctx, site, buyer.cookie, { resource: API_URL }))
    .access_token;
  const res = await ctx.app.request('/v1/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${siteBearer}`,
      'x-user-token': userBearer,
    },
    body: JSON.stringify({ sku: 'atlas-odyssey-desktop', currency: 'KRW', returnUrl: RETURN_URL }),
  });
  const { order } = (await res.json()) as { order: { id: string } };
  return { ...ctx, toss, site, buyer, siteBearer, orderId: order.id };
}

type Setup = Awaited<ReturnType<typeof setup>>;

// The event the fake's verifyWebhook hands the route, as the Toss adapter would after its lookup.
function event(
  orderRef: string | null,
  status: WebhookEvent['status'],
  { amount = 12000, bodyStatus = 'DONE' }: { amount?: number; bodyStatus?: string } = {},
): Omit<WebhookEvent, 'raw'> {
  return {
    eventId: `${KEY}:${bodyStatus}:${CREATED_AT}`,
    eventType: 'PAYMENT_STATUS_CHANGED',
    providerPaymentKey: KEY,
    status,
    orderRef,
    payment: {
      status,
      providerPaymentKey: KEY,
      amount,
      currency: 'KRW',
      methodSummary: '카드 43301234****123*',
      receiptUrl: 'https://dashboard.tosspayments.com/receipt/abc',
      ...(status === 'failed' ? { failureReason: 'ABORTED' } : {}),
      raw: {},
    },
  };
}

async function deliver(ctx: Setup, e: Omit<WebhookEvent, 'raw'>, signature?: string) {
  const req = ctx.toss.webhookRequest(e, signature ? { signature } : {});
  return ctx.app.request('/webhooks/toss', {
    method: 'POST',
    headers: req.headers,
    body: await req.text(),
  });
}

function confirm(ctx: Setup) {
  return ctx.app.request('/v1/payments/toss/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.siteBearer}` },
    body: JSON.stringify({ paymentKey: KEY, orderId: ctx.orderId, amount: 12000 }),
  });
}

async function state(db: Ctx['db']) {
  const all = async <T>(query: SQL) => ((await db.execute(query)) as { rows: T[] }).rows;
  return {
    orders: await all<{ status: string }>(sql`select status from "order"`),
    payments: await all<{ status: string }>(sql`select status from payment`),
    entitlements: await all<{ status: string }>(sql`select status from entitlement`),
    events: await all<{ provider: string; event_id: string; status: string; error: string | null }>(
      sql`select provider, event_id, status, error from webhook_event`,
    ),
  };
}

const calls = (fake: FakeProvider, method: string) =>
  fake.calls.filter((call) => call.method === method);

describe('POST /webhooks/toss', () => {
  it('FR-48 FR-39 fulfils a pending order whose confirm answer was lost', async () => {
    const ctx = await setup();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const res = await deliver(ctx, event(ctx.orderId, 'done'));

    expect(res.status).toBe(200);
    expect(await state(ctx.db)).toEqual({
      orders: [{ status: 'fulfilled' }],
      payments: [{ status: 'done' }],
      entitlements: [{ status: 'active' }],
      events: [
        {
          provider: 'toss',
          event_id: `${KEY}:DONE:${CREATED_AT}`,
          status: 'processed',
          error: null,
        },
      ],
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(ctx.buyer.email);
  });

  it('FR-68 answers an event it already processed with 200 and does nothing again', async () => {
    const ctx = await setup();
    await deliver(ctx, event(ctx.orderId, 'done'));
    const before = await state(ctx.db);

    const again = await deliver(ctx, event(ctx.orderId, 'done'));

    expect(again.status).toBe(200);
    expect(await state(ctx.db)).toEqual(before);
  });

  it('FR-48 FR-61 refunds a fulfilled order canceled at Toss and revokes the product', async () => {
    const ctx = await setup();
    await confirm(ctx);

    const res = await deliver(ctx, event(ctx.orderId, 'canceled', { bodyStatus: 'CANCELED' }));

    expect(res.status).toBe(200);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'refunded' }],
      payments: [{ status: 'canceled' }],
      entitlements: [{ status: 'revoked' }],
    });
  });

  it('FR-37 gives back a payment Toss approved for another amount', async () => {
    const ctx = await setup();

    const res = await deliver(ctx, event(ctx.orderId, 'done', { amount: 1000 }));

    expect(res.status).toBe(200);
    expect(calls(ctx.toss, 'cancel')).toHaveLength(1);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'failed' }],
      entitlements: [],
    });
  });

  it('FR-48 fails a pending order whose payment was aborted at Toss', async () => {
    const ctx = await setup();

    const res = await deliver(ctx, event(ctx.orderId, 'failed', { bodyStatus: 'ABORTED' }));

    expect(res.status).toBe(200);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'failed' }],
      payments: [{ status: 'failed' }],
    });
  });

  it('FR-48 leaves an order alone that is already in step', async () => {
    const ctx = await setup();
    await confirm(ctx);

    const res = await deliver(ctx, event(ctx.orderId, 'done'));

    expect(res.status).toBe(200);
    expect(calls(ctx.toss, 'cancel')).toEqual([]);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'fulfilled' }],
      payments: [{ status: 'done' }],
      entitlements: [{ status: 'active' }],
    });
  });

  it('FR-70 answers 400 to a webhook it cannot verify and changes nothing', async () => {
    const ctx = await setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await deliver(ctx, event(ctx.orderId, 'done'), 'forged');

    expect(res.status).toBe(400);
    expect(await state(ctx.db)).toEqual({
      orders: [{ status: 'pending' }],
      payments: [],
      entitlements: [],
      events: [],
    });
  });

  it('FR-69 records a failed processing, answers 500, and processes the event when it comes again', async () => {
    const ctx = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = ctx.deps.db;
    let down = true;
    ctx.deps.db = {
      execute: (query: SQL) => {
        if (down && JSON.stringify(query.queryChunks).includes('update \\"order\\"')) {
          return Promise.reject(new Error('database went away'));
        }
        return real.execute(query);
      },
    };

    const first = await deliver(ctx, event(ctx.orderId, 'done'));
    expect(first.status).toBe(500);
    expect((await state(ctx.db)).events).toEqual([
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('went away') }),
    ]);

    down = false;
    const retried = await deliver(ctx, event(ctx.orderId, 'done'));

    expect(retried.status).toBe(200);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'fulfilled' }],
      events: [expect.objectContaining({ status: 'processed', error: null })],
    });
  });

  it('FR-67 acknowledges a payment for an order that is not ours', async () => {
    const ctx = await setup();

    const res = await deliver(ctx, event(crypto.randomUUID(), 'done'));
    const notUuid = await deliver(ctx, {
      ...event('ORDER-FROM-ELSEWHERE', 'done'),
      eventId: 'other:DONE:x',
    });

    expect([res.status, notUuid.status]).toEqual([200, 200]);
    expect(await state(ctx.db)).toMatchObject({
      orders: [{ status: 'pending' }],
      payments: [],
    });
  });

  it('FR-42 NFR-11 keeps orders in step even when payments are off', async () => {
    const ctx = await setup();
    ctx.deps.paymentsMode = 'off';

    const res = await deliver(ctx, event(ctx.orderId, 'done'));

    expect(res.status).toBe(200);
    expect((await state(ctx.db)).orders).toEqual([{ status: 'fulfilled' }]);
  });
});
