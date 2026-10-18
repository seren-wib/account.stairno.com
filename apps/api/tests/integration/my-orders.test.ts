import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, siteToken } from '../helpers/oidc';

// FR-32, FR-63: the account center shows the user's orders and payments, across every site,
// with the receipt and the state of a refund request. Abandoned checkouts are left out.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

interface OrderItem {
  id: string;
  sku: string;
  name: { ko: string; en: string };
  kind: string;
  status: string;
  amount: number;
  currency: string;
  provider: string;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  payment: { status: string; methodSummary: string | null; receiptUrl: string | null } | null;
  refundRequest: { status: string; requestedAt: string; resolvedAt: string | null } | null;
}

async function all<T>(db: Ctx['db'], query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

async function setup() {
  const ctx = await createTestApp();
  const site = await registerLabs(ctx);
  await addProduct(ctx.db, {
    sku: 'atlas-desktop',
    clientId: site.clientId,
    nameKo: '아틀라스 데스크톱',
    nameEn: 'Atlas Desktop',
    kind: 'one_time',
    prices: [{ currency: 'KRW', amount: 12000 }],
  });
  const buyer = await signUp(ctx.app);
  const other = await signUp(ctx.app);
  const idOf = async (email: string) =>
    (await all<{ id: string }>(ctx.db, sql`select id from "user" where email = ${email}`))[0]!.id;
  const buyerId = await idOf(buyer.email);
  const otherId = await idOf(other.email);
  // An order `minutes` ago in a given state, with a done payment when it was paid.
  const order = async (status: string, minutes: number, userId = buyerId) => {
    const [made] = await all<{ id: string }>(
      ctx.db,
      sql`insert into "order" (user_id, client_id, product_id, currency, amount, status, provider,
                               return_url, created_at, expires_at, paid_at, refunded_at)
          select ${userId}, ${site.clientId}, p.id, 'KRW', 12000, ${status}, 'toss',
                 'https://stairnolabs.com/done', now() - make_interval(mins => ${minutes}),
                 now(), case when ${status} in ('paid', 'fulfilled', 'refunded') then now() end,
                 case when ${status} = 'refunded' then now() end
          from product p returning id`,
    );
    if (['paid', 'fulfilled', 'refunded', 'failed'].includes(status)) {
      await ctx.db.execute(sql`
        insert into payment (order_id, provider, provider_payment_key, status, method_summary,
                             receipt_url)
        values (${made!.id}, 'toss', ${`pay_${made!.id}`},
                ${status === 'failed' ? 'failed' : status === 'refunded' ? 'canceled' : 'done'},
                '카드 43301234****123*', 'https://dashboard.tosspayments.com/receipt/x')`);
    }
    return made!.id;
  };
  const list = async (query = '', cookie = buyer.cookie) =>
    (await (await get(ctx.app, `/v1/me/orders${query}`, cookie)).json()) as {
      items: OrderItem[];
      nextCursor: string | null;
    };
  return { ...ctx, site, buyer, other, buyerId, otherId, order, list };
}

describe('GET /v1/me/orders', () => {
  it('FR-32 lists paid, refunded and failed orders newest first, without abandoned checkouts', async () => {
    const ctx = await setup();
    const fulfilled = await ctx.order('fulfilled', 30);
    const refunded = await ctx.order('refunded', 20);
    const failed = await ctx.order('failed', 10);
    await ctx.order('pending', 5);
    await ctx.order('expired', 40);

    const { items, nextCursor } = await ctx.list();

    expect(items.map((o) => o.id)).toEqual([failed, refunded, fulfilled]);
    expect(nextCursor).toBeNull();
    expect(items[2]).toEqual({
      id: fulfilled,
      sku: 'atlas-desktop',
      name: { ko: '아틀라스 데스크톱', en: 'Atlas Desktop' },
      kind: 'one_time',
      status: 'fulfilled',
      amount: 12000,
      currency: 'KRW',
      provider: 'toss',
      createdAt: expect.any(String),
      paidAt: expect.any(String),
      refundedAt: null,
      payment: {
        status: 'done',
        methodSummary: '카드 43301234****123*',
        receiptUrl: 'https://dashboard.tosspayments.com/receipt/x',
      },
      refundRequest: null,
    });
    expect(items[1]).toMatchObject({ status: 'refunded', payment: { status: 'canceled' } });
  });

  it('FR-63 shows the state of a refund request on its order', async () => {
    const ctx = await setup();
    const id = await ctx.order('fulfilled', 10);
    await ctx.db.execute(sql`
      insert into refund_request (order_id, user_id, reason, status)
      values (${id}, ${ctx.buyerId}, 'Please.', 'requested')`);

    const [item] = (await ctx.list()).items;

    expect(item!.refundRequest).toEqual({
      status: 'requested',
      requestedAt: expect.any(String),
      resolvedAt: null,
    });
  });

  it('FR-32 shows only the user’s own orders', async () => {
    const ctx = await setup();
    const mine = await ctx.order('fulfilled', 10);
    const theirs = await ctx.order('fulfilled', 10, ctx.otherId);

    expect((await ctx.list()).items.map((o) => o.id)).toEqual([mine]);
    expect((await ctx.list('', ctx.other.cookie)).items.map((o) => o.id)).toEqual([theirs]);
  });

  it('SDD §8 pages with a cursor, at most 50 a page', async () => {
    const ctx = await setup();
    const ids = [];
    for (let i = 1; i <= 3; i += 1) ids.unshift(await ctx.order('fulfilled', i * 10));

    const first = await ctx.list('?limit=2');
    const second = await ctx.list(`?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);

    expect(first.items.map((o) => o.id)).toEqual(ids.reverse().slice(0, 2));
    expect(second.items.map((o) => o.id)).toEqual([ids[2]]);
    expect(second.nextCursor).toBeNull();
    const tooMany = await get(ctx.app, '/v1/me/orders?limit=51', ctx.buyer.cookie);
    expect(tooMany.status).toBe(422);
    const badCursor = await get(ctx.app, '/v1/me/orders?cursor=nonsense', ctx.buyer.cookie);
    expect(badCursor.status).toBe(422);
  });
});

describe('GET /v1/me/orders/{id}', () => {
  it('FR-32 shows one of the user’s orders', async () => {
    const ctx = await setup();
    const id = await ctx.order('fulfilled', 10);

    const res = await get(ctx.app, `/v1/me/orders/${id}`, ctx.buyer.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id,
      status: 'fulfilled',
      payment: { status: 'done' },
    });
  });

  it('FR-32 answers 404 for someone else’s order, an abandoned one, or a malformed id', async () => {
    const ctx = await setup();
    const theirs = await ctx.order('fulfilled', 10, ctx.otherId);
    const pending = await ctx.order('pending', 10);

    for (const id of [theirs, pending, 'nope']) {
      expect((await get(ctx.app, `/v1/me/orders/${id}`, ctx.buyer.cookie)).status, id).toBe(404);
    }
  });
});

describe('who may read the order history', () => {
  it('SDD §8 only the account center session, not a site or a token the user gave a site', async () => {
    const ctx = await setup();
    const userToken = (await signInToSite(ctx, ctx.site, ctx.buyer.cookie, { resource: API_URL }))
      .access_token;
    const bearer = (token: string) =>
      ctx.app.request('/v1/me/orders', { headers: { authorization: `Bearer ${token}` } });

    expect((await bearer(userToken)).status).toBe(401);
    expect((await bearer(await siteToken(ctx, ctx.site))).status).toBe(403);
  });
});
