import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { createFakeProvider } from '../../src/payments/fake';
import { ACCOUNT_URL, API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, siteToken } from '../helpers/oidc';

// FR-46, UC-7: a site orders a subscription product for its buyer, and the API charges the
// buyer's default card at once (SDD §6.4). The card was added in the account center (UC-5).

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const RETURN_URL = 'https://stairnolabs.com/checkout/done';
const SECRET = 'test-billing-key-secret-0123456789abcdef';

function plan(clientId: string, change: Record<string, unknown> = {}) {
  return {
    sku: 'atlas-pro-monthly',
    clientId,
    nameKo: '아틀라스 프로 월간',
    nameEn: 'Atlas Pro Monthly',
    kind: 'subscription',
    interval: 'month',
    prices: [
      { currency: 'KRW', amount: 4900 },
      { currency: 'USD', amount: 400 },
    ],
    ...change,
  };
}

async function setup({ card = true } = {}) {
  const toss = createFakeProvider();
  const ctx = await createTestApp({ providers: { toss }, billingKeySecret: SECRET });
  const site = await registerLabs(ctx);
  const buyer = await signUp(ctx.app);
  await ctx.db.execute(sql`update "user" set email_verified = true where email = ${buyer.email}`);
  await addProduct(ctx.db, plan(site.clientId));
  await addProduct(
    ctx.db,
    plan(site.clientId, {
      sku: 'atlas-pro-yearly',
      nameKo: '연간',
      nameEn: 'Yearly',
      interval: 'year',
    }),
  );

  if (card) {
    const { customerKey } = (await (
      await get(ctx.app, '/v1/payment-methods', buyer.cookie)
    ).json()) as { customerKey: string };
    const added = await ctx.app.request('/v1/payment-methods/toss', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: buyer.cookie, origin: ACCOUNT_URL },
      body: JSON.stringify({ authKey: 'auth_1', customerKey }),
    });
    expect(added.status).toBe(201);
  }

  const siteBearer = await siteToken(ctx, site);
  const userBearer = (await signInToSite(ctx, site, buyer.cookie, { resource: API_URL }))
    .access_token;
  const order = (body: Record<string, unknown> = {}) =>
    ctx.app.request('/v1/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${siteBearer}`,
        'x-user-token': userBearer,
      },
      body: JSON.stringify({
        sku: 'atlas-pro-monthly',
        currency: 'KRW',
        returnUrl: RETURN_URL,
        ...body,
      }),
    });
  return { ...ctx, toss, site, buyer, order };
}

async function all<T>(db: Awaited<ReturnType<typeof setup>>['db'], query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

const charges = (toss: ReturnType<typeof createFakeProvider>) =>
  toss.calls.filter((call) => call.method === 'chargeBillingKey');

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('POST /v1/orders for a subscription', () => {
  it('FR-46 UC-7 charges the default card at once and starts the subscription', async () => {
    const ctx = await setup();

    const res = await ctx.order();

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      order: { id: string; status: string; amount: number; currency: string };
      payment: { status: string };
      subscription: {
        id: string;
        status: string;
        currentPeriodEnd: string;
        cancelAtPeriodEnd: boolean;
      };
      checkout?: unknown;
    };
    expect(body.order).toMatchObject({ status: 'fulfilled', amount: 4900, currency: 'KRW' });
    expect(body.payment).toMatchObject({ status: 'done' });
    expect(body.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
    expect(body.checkout).toBeUndefined();

    const [card] = await all<{ id: string; customer_key: string }>(
      ctx.db,
      sql`select id, customer_key from payment_method`,
    );
    expect(charges(ctx.toss)).toEqual([
      {
        method: 'chargeBillingKey',
        input: {
          billingKey: 'fake_billing_1',
          customerKey: card!.customer_key,
          order: { id: body.order.id, amount: 4900, currency: 'KRW' },
          orderName: '아틀라스 프로 월간',
        },
      },
    ]);

    const [sub] = await all<Record<string, unknown>>(
      ctx.db,
      sql`select id, status, payment_method_id, retry_count, cancel_at_period_end,
                 last_attempt_on = current_date as attempted_today,
                 current_period_end = current_period_start + interval '1 month' as one_month
          from subscription`,
    );
    expect(sub).toMatchObject({
      id: body.subscription.id,
      status: 'active',
      payment_method_id: card!.id,
      retry_count: 0,
      cancel_at_period_end: false,
      attempted_today: true,
      one_month: true,
    });

    const [entitlement] = await all<Record<string, unknown>>(
      ctx.db,
      sql`select e.status, e.source_order_id, e.source_subscription_id,
                 e.expires_at = s.current_period_end as until_period_end
          from entitlement e join subscription s on s.id = e.source_subscription_id`,
    );
    expect(entitlement).toEqual({
      status: 'active',
      source_order_id: body.order.id,
      source_subscription_id: body.subscription.id,
      until_period_end: true,
    });
    expect(new Date(body.subscription.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now());
  });

  it('FR-46 runs a yearly plan for a year', async () => {
    const ctx = await setup();

    expect((await ctx.order({ sku: 'atlas-pro-yearly' })).status).toBe(201);

    const [sub] = await all<{ one_year: boolean }>(
      ctx.db,
      sql`select current_period_end = current_period_start + interval '1 year' as one_year
          from subscription`,
    );
    expect(sub?.one_year).toBe(true);
  });

  it('FR-46 UC-7 asks for a card first and charges nothing when there is none', async () => {
    const ctx = await setup({ card: false });

    const res = await ctx.order();

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('payment_method_required');
    expect(charges(ctx.toss)).toEqual([]);
    expect(await all(ctx.db, sql`select id from "order"`)).toEqual([]);
  });

  it('DR-5 FR-46 sells subscriptions in KRW only, on a saved Toss card', async () => {
    const ctx = await setup();

    const res = await ctx.order({ currency: 'USD' });

    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('validation_failed');
    expect(charges(ctx.toss)).toEqual([]);
    expect(await all(ctx.db, sql`select id from "order"`)).toEqual([]);
  });

  it('FR-46 refuses a second subscription to the same plan', async () => {
    const ctx = await setup();
    expect((await ctx.order()).status).toBe(201);

    const res = await ctx.order();

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('conflict');
    expect(charges(ctx.toss)).toHaveLength(1);
  });

  it('FR-46 FR-55 fails the order on a decline and starts nothing', async () => {
    const ctx = await setup();
    ctx.toss.willDecline('REJECT_CARD_PAYMENT');

    const res = await ctx.order();

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      order: { status: string };
      payment: { status: string; failureReason: string };
      subscription: unknown;
    };
    expect(body.order.status).toBe('failed');
    expect(body.payment).toMatchObject({ status: 'failed', failureReason: 'REJECT_CARD_PAYMENT' });
    expect(body.subscription).toBeNull();
    expect(await all(ctx.db, sql`select id from subscription`)).toEqual([]);
    expect(await all(ctx.db, sql`select id from entitlement`)).toEqual([]);
  });

  it('FR-46 answers 502 and fails the order when Toss cannot be reached', async () => {
    const ctx = await setup();
    ctx.toss.willThrow();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await ctx.order();

    expect(res.status).toBe(502);
    expect(await errorCode(res)).toBe('provider_error');
    expect(await all(ctx.db, sql`select status from "order"`)).toEqual([{ status: 'failed' }]);
    expect(await all(ctx.db, sql`select id from subscription`)).toEqual([]);
    // NFR-21: the order id, nothing about the buyer.
    expect(JSON.stringify(errors.mock.calls)).not.toContain(ctx.buyer.email);
    expect(JSON.stringify(errors.mock.calls)).toContain('orderId');
  });

  it('FR-58 still needs no order for a free plan', async () => {
    const ctx = await setup();
    await addProduct(
      ctx.db,
      plan(ctx.site.clientId, { sku: 'atlas-free', prices: [{ currency: 'KRW', amount: 0 }] }),
    );

    const res = await ctx.order({ sku: 'atlas-free' });

    expect(res.status).toBe(422);
    expect(charges(ctx.toss)).toEqual([]);
  });
});

describe('a Toss webhook about a subscription order', () => {
  it('FR-46 FR-48 leaves a pending subscription order to the side that charged it', async () => {
    const ctx = await setup();
    // An order the route has created and not yet settled, as if the webhook won the race.
    const [product] = await all<{ id: string }>(
      ctx.db,
      sql`select id from product where sku = 'atlas-pro-monthly'`,
    );
    const [buyer] = await all<{ id: string }>(
      ctx.db,
      sql`select id from "user" where email = ${ctx.buyer.email}`,
    );
    const [pending] = await all<{ id: string }>(
      ctx.db,
      sql`insert into "order" (user_id, client_id, product_id, currency, amount, status, provider,
                               return_url, expires_at)
          values (${buyer!.id}, ${ctx.site.clientId}, ${product!.id}, 'KRW', 4900, 'pending',
                  'toss', ${RETURN_URL}, now() + interval '30 minutes')
          returning id`,
    );

    const res = await ctx.app.request(
      '/webhooks/toss',
      ctx.toss.webhookRequest({
        eventId: 'evt_1',
        eventType: 'PAYMENT_STATUS_CHANGED',
        providerPaymentKey: 'pay_1',
        status: 'done',
        orderRef: pending!.id,
        payment: {
          status: 'done',
          providerPaymentKey: 'pay_1',
          amount: 4900,
          currency: 'KRW',
          raw: {},
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(await all(ctx.db, sql`select status from "order"`)).toEqual([{ status: 'pending' }]);
    expect(await all(ctx.db, sql`select id from entitlement`)).toEqual([]);
  });
});
