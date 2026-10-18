import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, registerSite, signInToSite, siteToken } from '../helpers/oidc';

// FR-63, FR-66: a site files its buyer's refund request; an operator decides it later (FR-64).
// The API keeps the request and never judges the refund policy. The account center shows the
// request's state.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

async function all<T>(db: Ctx['db'], query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

const RETURN_URL = 'https://stairnolabs.com/checkout/done';

async function setup() {
  const ctx = await createTestApp();
  const site = await registerLabs(ctx);
  await addProduct(ctx.db, {
    sku: 'atlas-desktop',
    clientId: site.clientId,
    nameKo: '아틀라스',
    nameEn: 'Atlas',
    kind: 'one_time',
    prices: [{ currency: 'KRW', amount: 12000 }],
  });
  const buyer = await signUp(ctx.app);
  const [row] = await all<{ id: string }>(
    ctx.db,
    sql`select id from "user" where email = ${buyer.email}`,
  );
  const siteBearer = await siteToken(ctx, site);
  const userBearer = (await signInToSite(ctx, site, buyer.cookie, { resource: API_URL }))
    .access_token;
  // An order in a given state, as the payment flow would have left it.
  const order = async (status = 'fulfilled', userId = row!.id, clientId = site.clientId) => {
    const [made] = await all<{ id: string }>(
      ctx.db,
      sql`insert into "order" (user_id, client_id, product_id, currency, amount, status, provider,
                               return_url, expires_at)
          select ${userId}, ${clientId}, p.id, 'KRW', 12000, ${status}, 'toss', ${RETURN_URL},
                 now() + interval '30 minutes'
          from product p where p.sku = 'atlas-desktop'
          returning id`,
    );
    return made!.id;
  };
  const request = (body: unknown, tokens: { site?: string; user?: string } = {}) =>
    ctx.app.request('/v1/refund-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens.site ?? siteBearer}`,
        'x-user-token': tokens.user ?? userBearer,
      },
      body: JSON.stringify(body),
    });
  return { ...ctx, site, buyer, buyerId: row!.id, siteBearer, userBearer, order, request };
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('POST /v1/refund-requests', () => {
  it('FR-63 files the buyer’s request for a paid order', async () => {
    const ctx = await setup();
    const orderId = await ctx.order();

    const res = await ctx.request({ orderId, reason: 'The app does not start on my laptop.' });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: expect.any(String),
      orderId,
      status: 'requested',
      requestedAt: expect.any(String),
      resolvedAt: null,
    });
    expect(
      await all(ctx.db, sql`select order_id, user_id, reason, status from refund_request`),
    ).toEqual([
      {
        order_id: orderId,
        user_id: ctx.buyerId,
        reason: 'The app does not start on my laptop.',
        status: 'requested',
      },
    ]);
  });

  it('FR-63 keeps one open request per order', async () => {
    const ctx = await setup();
    const orderId = await ctx.order();
    await ctx.request({ orderId, reason: 'First.' });

    const res = await ctx.request({ orderId, reason: 'Again.' });

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('conflict');
  });

  it.each(['pending', 'failed', 'expired', 'refunded'])(
    'FR-63 refuses a %s order, which has nothing to refund',
    async (status) => {
      const ctx = await setup();
      const orderId = await ctx.order(status);

      const res = await ctx.request({ orderId, reason: 'Please.' });

      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe('invalid_transition');
    },
  );

  it('FR-63 answers 404 for another buyer’s order or another site’s', async () => {
    const ctx = await setup();
    const other = await signUp(ctx.app);
    const [otherRow] = await all<{ id: string }>(
      ctx.db,
      sql`select id from "user" where email = ${other.email}`,
    );
    const works = await registerSite(
      ctx,
      'Stairno Works',
      'https://stairnoworks.com/auth/callback',
    );

    for (const orderId of [
      await ctx.order('fulfilled', otherRow!.id),
      await ctx.order('fulfilled', ctx.buyerId, works.clientId),
      '00000000-0000-4000-8000-000000000000',
    ]) {
      const res = await ctx.request({ orderId, reason: 'Please.' });
      expect(res.status, orderId).toBe(404);
    }
    expect(await all(ctx.db, sql`select id from refund_request`)).toEqual([]);
  });

  it('FR-63 needs an order id and a reason of reasonable length', async () => {
    const ctx = await setup();
    const orderId = await ctx.order();

    for (const body of [
      { orderId },
      { orderId, reason: '' },
      { orderId, reason: 'x'.repeat(1001) },
      { reason: 'Please.' },
    ]) {
      const res = await ctx.request(body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(422);
    }
  });

  it('FR-35 SDD §8 takes the buyer from the token the site forwards, issued to that site', async () => {
    const ctx = await setup();
    const orderId = await ctx.order();
    const works = await registerSite(
      ctx,
      'Stairno Works',
      'https://stairnoworks.com/auth/callback',
    );

    const noBuyer = await ctx.app.request('/v1/refund-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.siteBearer}` },
      body: JSON.stringify({ orderId, reason: 'Please.' }),
    });
    const otherSite = await ctx.request(
      { orderId, reason: 'Please.' },
      { site: await siteToken(ctx, works) },
    );
    const asUser = await ctx.request({ orderId, reason: 'Please.' }, { site: ctx.userBearer });

    expect(noBuyer.status).toBe(401);
    expect(otherSite.status).toBe(403);
    expect(asUser.status).toBe(403);
  });
});

describe('GET /v1/refund-requests', () => {
  it('FR-63 shows the account center the user’s requests and their state', async () => {
    const ctx = await setup();
    const orderId = await ctx.order();
    await ctx.request({ orderId, reason: 'Please.' });

    const res = await get(ctx.app, '/v1/refund-requests', ctx.buyer.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [
        {
          id: expect.any(String),
          orderId,
          sku: 'atlas-desktop',
          name: { ko: '아틀라스', en: 'Atlas' },
          amount: 12000,
          currency: 'KRW',
          status: 'requested',
          requestedAt: expect.any(String),
          resolvedAt: null,
        },
      ],
      nextCursor: null,
    });
  });
});
