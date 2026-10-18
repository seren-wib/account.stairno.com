import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { createFakeProvider } from '../../src/payments/fake';
import { ACCOUNT_URL, API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, siteToken } from '../helpers/oidc';

// FR-32, FR-56, UC-8: the account center lists the user's subscriptions and ends one at the end
// of its period, or takes that back while the period runs. Only its own session does this.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const RETURN_URL = 'https://stairnolabs.com/checkout/done';
const SECRET = 'test-billing-key-secret-0123456789abcdef';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

interface SubscriptionJson {
  id: string;
  sku: string;
  name: { ko: string; en: string };
  status: string;
  amount: number;
  currency: string;
  interval: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  card: { cardCompany: string | null; cardLast4: string | null } | null;
}

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
  const userToken = (await signInToSite(ctx, site, buyer.cookie, { resource: API_URL }))
    .access_token;
  const res = await ctx.app.request('/v1/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await siteToken(ctx, site)}`,
      'x-user-token': userToken,
    },
    body: JSON.stringify({ sku: 'atlas-pro-monthly', currency: 'KRW', returnUrl: RETURN_URL }),
  });
  expect(res.status).toBe(201);
  const { subscription } = (await res.json()) as { subscription: { id: string } };
  const send = (method: string, path: string, origin = ACCOUNT_URL) =>
    ctx.app.request(path, { method, headers: { cookie: buyer.cookie, origin } });
  const list = async () =>
    (await (await get(ctx.app, '/v1/subscriptions', buyer.cookie)).json()) as {
      items: SubscriptionJson[];
      nextCursor: string | null;
    };
  return { buyer, userToken, subscriptionId: subscription.id, send, list };
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
  return { ...ctx, toss, site, ...(await subscriber(ctx, site)) };
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('GET /v1/subscriptions', () => {
  it('FR-32 lists the user’s subscriptions with the plan, the period and the card', async () => {
    const ctx = await setup();

    const { items, nextCursor } = await ctx.list();

    expect(nextCursor).toBeNull();
    expect(items).toEqual([
      {
        id: ctx.subscriptionId,
        sku: 'atlas-pro-monthly',
        name: { ko: '아틀라스 프로 월간', en: 'Atlas Pro Monthly' },
        status: 'active',
        amount: 4900,
        currency: 'KRW',
        interval: 'month',
        currentPeriodStart: expect.any(String),
        currentPeriodEnd: expect.any(String),
        cancelAtPeriodEnd: false,
        card: { cardCompany: 'Fake Card', cardLast4: '4242' },
      },
    ]);
  });

  it('FR-32 shows nobody else’s', async () => {
    const ctx = await setup();
    const other = await subscriber(ctx, ctx.site);

    const mine = await ctx.list();
    const theirs = await other.list();

    expect(mine.items.map((s) => s.id)).toEqual([ctx.subscriptionId]);
    expect(theirs.items.map((s) => s.id)).toEqual([other.subscriptionId]);
  });
});

describe('POST /v1/subscriptions/{id}/cancel and /resume', () => {
  it('FR-56 UC-8 ends the subscription at the end of its period, not now', async () => {
    const ctx = await setup();

    const res = await ctx.send('POST', `/v1/subscriptions/${ctx.subscriptionId}/cancel`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    const [entitlement] = (
      (await ctx.db.execute(
        sql`select status, expires_at > now() as running from entitlement`,
      )) as {
        rows: { status: string; running: boolean }[];
      }
    ).rows;
    expect(entitlement).toEqual({ status: 'active', running: true });
  });

  it('FR-56 takes the cancel back while the period runs', async () => {
    const ctx = await setup();
    await ctx.send('POST', `/v1/subscriptions/${ctx.subscriptionId}/cancel`);

    const res = await ctx.send('POST', `/v1/subscriptions/${ctx.subscriptionId}/resume`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
  });

  it('FR-56 FR-55 ends an overdue subscription at once, since its period is already over', async () => {
    const ctx = await setup();
    await ctx.db.execute(sql`update subscription set status = 'past_due', retry_count = 1`);

    const res = await ctx.send('POST', `/v1/subscriptions/${ctx.subscriptionId}/cancel`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'canceled' });
  });

  it('FR-56 cannot resume a subscription that is over', async () => {
    const ctx = await setup();
    for (const status of ['canceled', 'expired']) {
      await ctx.db.execute(sql`update subscription set status = ${status}`);

      const res = await ctx.send('POST', `/v1/subscriptions/${ctx.subscriptionId}/resume`);
      const again = await ctx.send('POST', `/v1/subscriptions/${ctx.subscriptionId}/cancel`);

      expect(res.status, status).toBe(409);
      expect(await errorCode(res)).toBe('invalid_transition');
      expect(again.status, status).toBe(409);
    }
  });

  it('FR-56 answers 404 for someone else’s subscription or an unknown one', async () => {
    const ctx = await setup();
    const other = await subscriber(ctx, ctx.site);

    for (const id of [other.subscriptionId, '00000000-0000-4000-8000-000000000000', 'nope']) {
      const res = await ctx.send('POST', `/v1/subscriptions/${id}/cancel`);
      expect(res.status, id).toBe(404);
    }
    expect((await other.list()).items[0]?.cancelAtPeriodEnd).toBe(false);
  });

  it('NFR-5 refuses a cancel from another origin', async () => {
    const ctx = await setup();

    const res = await ctx.send(
      'POST',
      `/v1/subscriptions/${ctx.subscriptionId}/cancel`,
      'https://evil.example',
    );

    expect(res.status).toBe(403);
    expect((await ctx.list()).items[0]?.cancelAtPeriodEnd).toBe(false);
  });
});

describe('who may manage subscriptions', () => {
  it('SDD §8 only the account center session, not a site or a user token', async () => {
    const ctx = await setup();
    const site = await siteToken(ctx, ctx.site);

    const bearer = (token: string) =>
      ctx.app.request('/v1/subscriptions', { headers: { authorization: `Bearer ${token}` } });

    // Like the card list: a user token is not the session (401), a site is not a user (403).
    expect((await bearer(ctx.userToken)).status).toBe(401);
    expect((await bearer(site)).status).toBe(403);
  });
});
