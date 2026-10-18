import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import worker from '../../src/index';
import { createFakeProvider } from '../../src/payments/fake';
import { renewDueSubscriptions } from '../../src/subscriptions/renew';
import { ACCOUNT_URL, API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, siteToken } from '../helpers/oidc';

// FR-46, FR-55 to FR-57 (SDD §6.4): the daily cron charges subscriptions whose period has ended,
// at most once a day each; a decline makes the subscription past_due and is retried every three
// days, three times, before it expires. A subscription set to end is canceled instead.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const RETURN_URL = 'https://stairnolabs.com/checkout/done';
const SECRET = 'test-billing-key-secret-0123456789abcdef';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

async function all<T>(db: Ctx['db'], query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

// A buyer with a card and a running monthly subscription, started through the order API.
async function subscriber(ctx: Ctx, site: Awaited<ReturnType<typeof registerLabs>>) {
  const buyer = await signUp(ctx.app);
  await ctx.db.execute(sql`update "user" set email_verified = true where email = ${buyer.email}`);
  const { customerKey } = (await (
    await get(ctx.app, '/v1/payment-methods', buyer.cookie)
  ).json()) as { customerKey: string };
  await ctx.app.request('/v1/payment-methods/toss', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: buyer.cookie, origin: ACCOUNT_URL },
    body: JSON.stringify({ authKey: `auth_${buyer.email}`, customerKey }),
  });
  const res = await ctx.app.request('/v1/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await siteToken(ctx, site)}`,
      'x-user-token': (await signInToSite(ctx, site, buyer.cookie, { resource: API_URL }))
        .access_token,
    },
    body: JSON.stringify({ sku: 'atlas-pro-monthly', currency: 'KRW', returnUrl: RETURN_URL }),
  });
  expect(res.status).toBe(201);
  const { subscription } = (await res.json()) as { subscription: { id: string } };
  return { buyer, subscriptionId: subscription.id };
}

async function setup() {
  const toss = createFakeProvider();
  const ctx = await createTestApp({ providers: { toss }, billingKeySecret: SECRET });
  const site = await registerLabs(ctx);
  await addProduct(ctx.db, {
    sku: 'atlas-pro-monthly',
    clientId: site.clientId,
    nameKo: '아틀라스 프로 월간',
    nameEn: 'Atlas Pro Monthly',
    kind: 'subscription',
    interval: 'month',
    prices: [{ currency: 'KRW', amount: 4900 }],
  });
  const first = await subscriber(ctx, site);
  return { ...ctx, toss, site, ...first };
}

// The period ended a minute ago, with the entitlement, and the last attempt was `daysAgo` days back.
async function due(
  db: Ctx['db'],
  id: string,
  change: { status?: string; retryCount?: number; daysAgo?: number } = {},
) {
  await db.execute(sql`
    update subscription set
      current_period_start = now() - interval '1 month' - interval '1 minute',
      current_period_end = now() - interval '1 minute',
      status = ${change.status ?? 'active'},
      retry_count = ${change.retryCount ?? 0},
      last_attempt_on = current_date - ${change.daysAgo ?? 31}::int
    where id = ${id}`);
  await db.execute(sql`
    update entitlement e set expires_at = s.current_period_end
    from subscription s
    where s.id = ${id} and e.source_subscription_id = s.id`);
}

async function subscription(db: Ctx['db'], id: string) {
  const [row] = await all<Record<string, unknown>>(
    db,
    sql`select s.status, s.retry_count, s.last_attempt_on = current_date as attempted_today,
               s.current_period_end > now() as running,
               s.current_period_end = s.current_period_start + interval '1 month' as one_month,
               e.expires_at = s.current_period_end as entitled_to_period_end
        from subscription s
        left join entitlement e on e.source_subscription_id = s.id
        where s.id = ${id}`,
  );
  return row;
}

const charges = (toss: ReturnType<typeof createFakeProvider>) =>
  toss.calls.filter((call) => call.method === 'chargeBillingKey');

describe('subscription renewal', () => {
  it('FR-46 FR-57 charges a due subscription on a new order and runs it one more period', async () => {
    const ctx = await setup();
    await due(ctx.db, ctx.subscriptionId);

    const summary = await renewDueSubscriptions(ctx.deps);

    expect(summary).toMatchObject({ renewed: 1, failed: 0, expired: 0, canceled: 0 });
    expect(charges(ctx.toss)).toHaveLength(2);
    const orders = await all<{ status: string; amount: number }>(
      ctx.db,
      sql`select status, amount from "order" order by created_at`,
    );
    expect(orders).toEqual([
      { status: 'fulfilled', amount: 4900 },
      { status: 'fulfilled', amount: 4900 },
    ]);
    expect(await subscription(ctx.db, ctx.subscriptionId)).toEqual({
      status: 'active',
      retry_count: 0,
      attempted_today: true,
      running: true,
      one_month: true,
      entitled_to_period_end: true,
    });
  });

  it('FR-57 charges a subscription once however often it runs that day', async () => {
    const ctx = await setup();
    await due(ctx.db, ctx.subscriptionId);
    ctx.toss.willDecline('REJECT_CARD_PAYMENT');

    await renewDueSubscriptions(ctx.deps);
    await renewDueSubscriptions(ctx.deps);

    expect(charges(ctx.toss)).toHaveLength(2);
  });

  it('FR-57 leaves a subscription whose period has not ended', async () => {
    const ctx = await setup();

    expect(await renewDueSubscriptions(ctx.deps)).toMatchObject({ renewed: 0, failed: 0 });
    expect(charges(ctx.toss)).toHaveLength(1);
  });

  it('FR-55 makes a declined subscription past_due and keeps its entitlement to the old end', async () => {
    const ctx = await setup();
    await due(ctx.db, ctx.subscriptionId);
    ctx.toss.willDecline('REJECT_CARD_PAYMENT');

    expect(await renewDueSubscriptions(ctx.deps)).toMatchObject({ renewed: 0, failed: 1 });

    expect(await subscription(ctx.db, ctx.subscriptionId)).toMatchObject({
      status: 'past_due',
      retry_count: 1,
      attempted_today: true,
      running: false,
      entitled_to_period_end: true,
    });
    const statuses = await all<{ status: string }>(
      ctx.db,
      sql`select status from "order" order by created_at`,
    );
    expect(statuses.map((o) => o.status)).toEqual(['fulfilled', 'failed']);
  });

  it('FR-55 retries a past_due subscription three days after the last attempt', async () => {
    const ctx = await setup();
    await due(ctx.db, ctx.subscriptionId, { status: 'past_due', retryCount: 1, daysAgo: 2 });

    await renewDueSubscriptions(ctx.deps);
    expect(charges(ctx.toss)).toHaveLength(1);

    await due(ctx.db, ctx.subscriptionId, { status: 'past_due', retryCount: 1, daysAgo: 3 });
    expect(await renewDueSubscriptions(ctx.deps)).toMatchObject({ renewed: 1 });

    expect(charges(ctx.toss)).toHaveLength(2);
    expect(await subscription(ctx.db, ctx.subscriptionId)).toMatchObject({
      status: 'active',
      retry_count: 0,
      running: true,
    });
  });

  it('FR-55 expires the subscription when the third retry is declined too', async () => {
    const ctx = await setup();
    await due(ctx.db, ctx.subscriptionId, { status: 'past_due', retryCount: 3, daysAgo: 3 });
    ctx.toss.willDecline('REJECT_CARD_PAYMENT');

    expect(await renewDueSubscriptions(ctx.deps)).toMatchObject({ failed: 1, expired: 1 });

    expect(await subscription(ctx.db, ctx.subscriptionId)).toMatchObject({
      status: 'expired',
      retry_count: 4,
    });
  });

  it('FR-56 ends a subscription set to end instead of charging it', async () => {
    const ctx = await setup();
    await due(ctx.db, ctx.subscriptionId);
    await ctx.db.execute(
      sql`update subscription set cancel_at_period_end = true where id = ${ctx.subscriptionId}`,
    );

    expect(await renewDueSubscriptions(ctx.deps)).toMatchObject({ canceled: 1, renewed: 0 });

    expect(charges(ctx.toss)).toHaveLength(1);
    expect(await subscription(ctx.db, ctx.subscriptionId)).toMatchObject({ status: 'canceled' });
  });

  it('FR-57 tries again tomorrow when Toss cannot be reached, and logs no buyer details', async () => {
    const ctx = await setup();
    await due(ctx.db, ctx.subscriptionId);
    ctx.toss.willThrow();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await renewDueSubscriptions(ctx.deps)).toMatchObject({ renewed: 0, failed: 0 });

    expect(await subscription(ctx.db, ctx.subscriptionId)).toMatchObject({
      status: 'active',
      retry_count: 0,
      attempted_today: true,
    });
    const statuses = await all<{ status: string }>(
      ctx.db,
      sql`select status from "order" order by created_at`,
    );
    expect(statuses.map((o) => o.status)).toEqual(['fulfilled', 'failed']);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(ctx.buyer.email);
  });

  it('FR-57 goes on with the others when one cannot be charged, and stops at the batch size', async () => {
    const ctx = await setup();
    const second = await subscriber(ctx, ctx.site);
    const third = await subscriber(ctx, ctx.site);
    for (const id of [ctx.subscriptionId, second.subscriptionId, third.subscriptionId]) {
      await due(ctx.db, id);
    }
    // The first subscriber's card can no longer be read.
    await ctx.db.execute(sql`
      update payment_method set billing_key = 'v1.broken.value'
      where id = (select payment_method_id from subscription where id = ${ctx.subscriptionId})`);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await renewDueSubscriptions(ctx.deps, { limit: 2 })).toMatchObject({
      renewed: 1,
      failed: 1,
    });
    expect(await renewDueSubscriptions(ctx.deps, { limit: 2 })).toMatchObject({ renewed: 1 });

    expect(await subscription(ctx.db, ctx.subscriptionId)).toMatchObject({ status: 'past_due' });
    for (const id of [second.subscriptionId, third.subscriptionId]) {
      expect(await subscription(ctx.db, id)).toMatchObject({ status: 'active', running: true });
    }
  });
});

describe('renewal while payments are off', () => {
  it('FR-42 charges nothing and changes nothing', async () => {
    const ctx = await setup();
    await due(ctx.db, ctx.subscriptionId);

    const summary = await renewDueSubscriptions({ ...ctx.deps, paymentsMode: 'off' });

    expect(summary).toEqual({ renewed: 0, failed: 0, expired: 0, canceled: 0, skipped: 0 });
    expect(charges(ctx.toss)).toHaveLength(1);
    expect(await subscription(ctx.db, ctx.subscriptionId)).toMatchObject({
      status: 'active',
      attempted_today: false,
    });
  });
});

describe('the Worker', () => {
  it('FR-57 has a scheduled handler for the daily cron', () => {
    expect(typeof worker.scheduled).toBe('function');
    expect(typeof worker.fetch).toBe('function');
  });
});
