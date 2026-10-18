import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, registerSite, signInToSite, siteToken, type Site } from '../helpers/oidc';

// FR-35, FR-40: a site creates and reads orders for its signed-in user. The site calls with its
// own token; the user is the one in X-User-Token, never a user id in the body.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

const RETURN_URL = 'https://stairnolabs.com/checkout/done';

function desktop(clientId: string, change: Record<string, unknown> = {}) {
  return {
    sku: 'atlas-odyssey-desktop',
    clientId,
    nameKo: '아틀라스 오디세이 데스크톱',
    nameEn: 'Atlas Odyssey Desktop',
    kind: 'one_time',
    prices: [
      { currency: 'KRW', amount: 12000 },
      { currency: 'USD', amount: 900 },
    ],
    ...change,
  };
}

async function userToken(ctx: Ctx, site: Site, cookie: string) {
  return (await signInToSite(ctx, site, cookie, { resource: API_URL })).access_token;
}

async function setup(overrides: Parameters<typeof createTestApp>[0] = {}) {
  const ctx = await createTestApp(overrides);
  const site = await registerLabs(ctx);
  const buyer = await signUp(ctx.app);
  await ctx.db.execute(sql`update "user" set email_verified = true where email = ${buyer.email}`);
  const [buyerRow] = (
    (await ctx.db.execute(sql`select id from "user" where email = ${buyer.email}`)) as {
      rows: { id: string }[];
    }
  ).rows;
  await addProduct(ctx.db, desktop(site.clientId));
  return {
    ...ctx,
    site,
    buyer,
    buyerId: buyerRow!.id,
    siteBearer: await siteToken(ctx, site),
    userBearer: await userToken(ctx, site, buyer.cookie),
  };
}

function createOrder(
  app: Ctx['app'],
  tokens: { site?: string; user?: string },
  body: Record<string, unknown> = {
    sku: 'atlas-odyssey-desktop',
    currency: 'KRW',
    returnUrl: RETURN_URL,
  },
) {
  return app.request('/v1/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(tokens.site ? { authorization: `Bearer ${tokens.site}` } : {}),
      ...(tokens.user ? { 'x-user-token': tokens.user } : {}),
    },
    body: JSON.stringify(body),
  });
}

function readOrder(app: Ctx['app'], token: string, id: string) {
  return app.request(`/v1/orders/${id}`, { headers: { authorization: `Bearer ${token}` } });
}

async function orderRows(db: Ctx['db']) {
  return (
    (await db.execute(
      sql`select user_id, client_id, status, currency, amount, provider, return_url,
                 extract(epoch from expires_at - created_at)::int as ttl from "order"`,
    )) as { rows: Record<string, unknown>[] }
  ).rows;
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('POST /v1/orders', () => {
  it('FR-35 FR-36 creates a pending KRW order through Toss for 30 minutes', async () => {
    const { app, db, site, buyerId, siteBearer, userBearer } = await setup();

    const res = await createOrder(app, { site: siteBearer, user: userBearer });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, Record<string, unknown>>;
    expect(body.order).toMatchObject({
      id: expect.any(String),
      status: 'pending',
      sku: 'atlas-odyssey-desktop',
      currency: 'KRW',
      amount: 12000,
      provider: 'toss',
    });
    expect(body.checkout).toEqual({
      provider: 'toss',
      orderId: body.order!.id,
      amount: 12000,
      currency: 'KRW',
      orderName: '아틀라스 오디세이 데스크톱',
    });
    expect(await orderRows(db)).toEqual([
      {
        user_id: buyerId,
        client_id: site.clientId,
        status: 'pending',
        currency: 'KRW',
        amount: 12000,
        provider: 'toss',
        return_url: RETURN_URL,
        ttl: 30 * 60,
      },
    ]);
  });

  it('FR-35 DR-5 sends a USD order to PayPal and names it in the buyer’s language', async () => {
    const { app, siteBearer, userBearer, db, buyer } = await setup();
    await db.execute(sql`update "user" set locale = 'en' where email = ${buyer.email}`);

    const res = await createOrder(
      app,
      { site: siteBearer, user: userBearer },
      { sku: 'atlas-odyssey-desktop', currency: 'USD', returnUrl: RETURN_URL },
    );

    expect(res.status).toBe(201);
    expect(((await res.json()) as { checkout: unknown }).checkout).toEqual({
      provider: 'paypal',
      orderId: expect.any(String),
      amount: 900,
      currency: 'USD',
      orderName: 'Atlas Odyssey Desktop',
    });
  });

  it('FR-35 takes the buyer from X-User-Token and ignores a user id in the body', async () => {
    const { app, db, buyerId, siteBearer, userBearer } = await setup();
    const other = await signUp(app);

    await createOrder(
      app,
      { site: siteBearer, user: userBearer },
      { sku: 'atlas-odyssey-desktop', currency: 'KRW', returnUrl: RETURN_URL, userId: other.email },
    );

    expect((await orderRows(db))[0]?.user_id).toBe(buyerId);
  });

  it('FR-35 needs the buyer’s token', async () => {
    const { app, db, siteBearer } = await setup();

    const res = await createOrder(app, { site: siteBearer });

    expect(res.status).toBe(401);
    expect(await orderRows(db)).toEqual([]);
  });

  it('FR-35 refuses a buyer token that was issued to another site', async () => {
    const ctx = await setup();
    const works = await registerSite(
      ctx,
      'Stairno Works',
      'https://stairnoworks.com/auth/callback',
    );
    const tokenForWorks = await userToken(ctx, works, ctx.buyer.cookie);

    const res = await createOrder(ctx.app, { site: ctx.siteBearer, user: tokenForWorks });

    expect(res.status).toBe(403);
    expect(await orderRows(ctx.db)).toEqual([]);
  });

  it('FR-35 SDD §8 only a site creates orders, not a user calling directly', async () => {
    const { app, db, buyer, userBearer } = await setup();

    const asUser = await createOrder(app, { site: userBearer, user: userBearer });
    const withCookie = await app.request('/v1/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: buyer.cookie,
        origin: 'https://account.stairno.com',
      },
      body: JSON.stringify({
        sku: 'atlas-odyssey-desktop',
        currency: 'KRW',
        returnUrl: RETURN_URL,
      }),
    });

    expect(asUser.status).toBe(403);
    expect(withCookie.status).toBe(403);
    expect(await orderRows(db)).toEqual([]);
  });

  it('FR-2 refuses a buyer whose email is not verified', async () => {
    const { app, db, buyer, siteBearer, userBearer } = await setup();
    await db.execute(sql`update "user" set email_verified = false where email = ${buyer.email}`);

    const res = await createOrder(app, { site: siteBearer, user: userBearer });

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('email_not_verified');
  });

  it('FR-42 answers 503 payments_off and writes nothing when payments are off', async () => {
    const { app, db, siteBearer, userBearer } = await setup({ paymentsMode: 'off' });

    const res = await createOrder(app, { site: siteBearer, user: userBearer });

    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('payments_off');
    expect(await orderRows(db)).toEqual([]);
  });

  it('FR-34 FR-40 sells only active products of the calling site', async () => {
    const ctx = await setup();
    const works = await registerSite(
      ctx,
      'Stairno Works',
      'https://stairnoworks.com/auth/callback',
    );
    await addProduct(ctx.db, desktop(works.clientId, { sku: 'works-retainer' }));
    await addProduct(ctx.db, desktop(ctx.site.clientId, { sku: 'retired-desktop' }));
    await ctx.db.execute(sql`update product set active = false where sku = 'retired-desktop'`);

    for (const sku of ['works-retainer', 'retired-desktop', 'no-such-product']) {
      const res = await createOrder(
        ctx.app,
        { site: ctx.siteBearer, user: ctx.userBearer },
        { sku, currency: 'KRW', returnUrl: RETURN_URL },
      );
      expect(res.status, sku).toBe(404);
    }
    expect(await orderRows(ctx.db)).toEqual([]);
  });

  it.each([
    ['a currency the product has no price in', { sku: 'krw-only', currency: 'USD' }],
    ['a subscription in USD', { sku: 'monthly', currency: 'USD' }],
    ['a free product', { sku: 'free-desktop' }],
    ['a return address on another site', { returnUrl: 'https://evil.example/done' }],
    ['a plain http return address', { returnUrl: 'http://stairnolabs.com/checkout/done' }],
    ['no sku', { sku: undefined }],
  ])('FR-35 answers 422 for %s and writes nothing', async (_, change) => {
    const ctx = await setup();
    await addProduct(
      ctx.db,
      desktop(ctx.site.clientId, { sku: 'krw-only', prices: [{ currency: 'KRW', amount: 5000 }] }),
    );
    await addProduct(
      ctx.db,
      desktop(ctx.site.clientId, { sku: 'monthly', kind: 'subscription', interval: 'month' }),
    );
    await addProduct(
      ctx.db,
      desktop(ctx.site.clientId, { sku: 'free-desktop', prices: [{ currency: 'KRW', amount: 0 }] }),
    );

    const res = await createOrder(
      ctx.app,
      { site: ctx.siteBearer, user: ctx.userBearer },
      { sku: 'atlas-odyssey-desktop', currency: 'KRW', returnUrl: RETURN_URL, ...change },
    );

    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('validation_failed');
    expect(await orderRows(ctx.db)).toEqual([]);
  });
});

describe('GET /v1/orders/{id}', () => {
  async function withOrder() {
    const ctx = await setup();
    const res = await createOrder(ctx.app, { site: ctx.siteBearer, user: ctx.userBearer });
    const { order } = (await res.json()) as { order: { id: string } };
    return { ...ctx, orderId: order.id };
  }

  it('FR-40 shows the site its own order', async () => {
    const { app, siteBearer, orderId } = await withOrder();

    const res = await readOrder(app, siteBearer, orderId);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: orderId,
      status: 'pending',
      sku: 'atlas-odyssey-desktop',
      currency: 'KRW',
      amount: 12000,
      provider: 'toss',
      paidAt: null,
      fulfilledAt: null,
      refundedAt: null,
    });
  });

  it('FR-40 answers 404 for another site’s order, an unknown id or a malformed one', async () => {
    const ctx = await withOrder();
    const works = await registerSite(
      ctx,
      'Stairno Works',
      'https://stairnoworks.com/auth/callback',
    );
    const worksToken = await siteToken(ctx, works);

    expect((await readOrder(ctx.app, worksToken, ctx.orderId)).status).toBe(404);
    expect((await readOrder(ctx.app, ctx.siteBearer, crypto.randomUUID())).status).toBe(404);
    expect((await readOrder(ctx.app, ctx.siteBearer, 'not-a-uuid')).status).toBe(404);
  });

  it('FR-36 a pending order past its 30 minutes reads as expired and stays expired', async () => {
    const { app, db, siteBearer, orderId } = await withOrder();
    await db.execute(sql`update "order" set expires_at = now() - interval '1 minute'`);

    const res = await readOrder(app, siteBearer, orderId);

    expect(((await res.json()) as { status: string }).status).toBe('expired');
    expect((await orderRows(db))[0]?.status).toBe('expired');
  });

  it('FR-36 does not touch an order that is no longer pending', async () => {
    const { app, db, siteBearer, orderId } = await withOrder();
    await db.execute(
      sql`update "order" set status = 'paid', paid_at = now(), expires_at = now() - interval '1 minute'`,
    );

    const res = await readOrder(app, siteBearer, orderId);

    expect(((await res.json()) as { status: string }).status).toBe('paid');
  });

  it('FR-42 NFR-11 still answers when payments are off', async () => {
    const ctx = await setup({ paymentsMode: 'off' });
    const [row] = (
      (await ctx.db.execute(sql`
        insert into "order" (user_id, client_id, product_id, currency, amount, status, provider,
                             return_url, expires_at)
        select ${ctx.buyerId}, ${ctx.site.clientId}, id, 'KRW', 12000, 'pending', 'toss',
               ${RETURN_URL}, now() + interval '30 minutes'
        from product returning id`)) as { rows: { id: string }[] }
    ).rows;

    expect((await readOrder(ctx.app, ctx.siteBearer, row!.id)).status).toBe(200);
  });

  it('SDD §8 is for the site, not the user', async () => {
    const { app, buyer, orderId } = await withOrder();

    expect((await get(app, `/v1/orders/${orderId}`, buyer.cookie)).status).toBe(403);
  });
});
