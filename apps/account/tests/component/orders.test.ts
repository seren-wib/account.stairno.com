import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Orders from '../../src/pages/[locale]/orders/index.astro';
import OrderDetail from '../../src/pages/[locale]/orders/[id].astro';
import { en } from '../../src/i18n/en';
import { ko } from '../../src/i18n/ko';

// FR-32, FR-63: the order history and one order, with its payment, receipt and refund request.

const COOKIE = 'stairno.session_token=abc';
const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

function order(change: Record<string, unknown> = {}) {
  return {
    id: '6f1c2c47-0d1e-4c1b-9f0a-3b0b6a0f0c11',
    sku: 'atlas-desktop',
    name: { ko: '아틀라스 데스크톱', en: 'Atlas Desktop' },
    kind: 'one_time',
    status: 'fulfilled',
    amount: 12000,
    currency: 'KRW',
    provider: 'toss',
    createdAt: '2026-10-18T09:00:00.000Z',
    paidAt: '2026-10-18T09:01:00.000Z',
    refundedAt: null,
    payment: {
      status: 'done',
      methodSummary: '카드 43301234****123*',
      receiptUrl: 'https://dashboard.tosspayments.com/receipt/x',
    },
    refundRequest: null,
    ...change,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(status = 200, body: unknown = { items: [order()], nextCursor: null }) {
  const api = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(body, { status }));
  vi.stubGlobal('fetch', api);
  return api;
}

async function renderList(locale = 'en', search = '') {
  const container = await AstroContainer.create();
  return container.renderToString(Orders, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/orders${search}`, {
      headers: { cookie: COOKIE },
    }),
    locals,
  });
}

async function renderDetail(id = order().id, locale = 'en') {
  const container = await AstroContainer.create();
  return container.renderToString(OrderDetail, {
    params: { locale, id },
    request: new Request(`https://account.stairno.com/${locale}/orders/${id}`, {
      headers: { cookie: COOKIE },
    }),
    locals,
  });
}

describe('orders page', () => {
  it('DR-1 reads the orders from the API with the visitor cookie', async () => {
    const api = stubApi();
    await renderList();
    const [url, init] = api.mock.calls[0] ?? [];
    expect(url).toBe('https://api.stairno.com/v1/me/orders');
    expect(new Headers(init?.headers).get('cookie')).toBe(COOKIE);
  });

  it('FR-32 lists each order with its product, date, amount and status, linking to it', async () => {
    stubApi();
    const html = await renderList();
    expect(html).toContain('Atlas Desktop');
    expect(html).toContain('Oct 18, 2026');
    expect(html).toContain('₩12,000');
    expect(html).toContain(en.orders.statuses.fulfilled);
    expect(html).toContain(`href="/en/orders/${order().id}/"`);
  });

  it('FR-76 names the product and the amount in the page language', async () => {
    stubApi();
    const html = await renderList('ko');
    expect(html).toContain('아틀라스 데스크톱');
    expect(html).toContain(ko.orders.statuses.fulfilled);
  });

  it('FR-63 shows an open refund request on its order', async () => {
    stubApi(200, {
      items: [
        order({
          refundRequest: {
            status: 'requested',
            requestedAt: '2026-10-18T10:00:00.000Z',
            resolvedAt: null,
          },
        }),
      ],
      nextCursor: null,
    });
    expect(await renderList()).toContain(en.orders.refund.requested);
  });

  it('SDD §8 links to the next page with the cursor', async () => {
    const api = stubApi(200, { items: [order()], nextCursor: 'abc_d' });
    const html = await renderList('en', '?cursor=prev');
    expect(api.mock.calls[0]?.[0]).toBe('https://api.stairno.com/v1/me/orders?cursor=prev');
    expect(html).toContain('href="/en/orders/?cursor=abc_d"');
    expect(html).toContain(en.orders.more);
  });

  it('says so when there is none, or when the list cannot be loaded', async () => {
    stubApi(200, { items: [], nextCursor: null });
    expect(await renderList()).toContain(en.orders.empty);
    stubApi(500, {});
    expect(await renderList()).toContain(en.orders.unavailable);
  });
});

describe('order page', () => {
  it('FR-32 shows the order, the card it was paid with and the receipt', async () => {
    const api = stubApi(200, order());
    const html = await renderDetail();
    expect(api.mock.calls[0]?.[0]).toBe(`https://api.stairno.com/v1/me/orders/${order().id}`);
    expect(html).toContain(order().id);
    expect(html).toContain('Atlas Desktop');
    expect(html).toContain('₩12,000');
    expect(html).toContain('카드 43301234****123*');
    expect(html).toContain('href="https://dashboard.tosspayments.com/receipt/x"');
    expect(html).toContain(`href="/en/orders/"`);
  });

  it('FR-61 FR-63 shows a refund and the decision on a request', async () => {
    stubApi(
      200,
      order({
        status: 'refunded',
        refundedAt: '2026-10-19T09:00:00.000Z',
        refundRequest: {
          status: 'refunded',
          requestedAt: '2026-10-18T10:00:00.000Z',
          resolvedAt: '2026-10-19T09:00:00.000Z',
        },
      }),
    );
    const html = await renderDetail();
    expect(html).toContain(en.orders.statuses.refunded);
    expect(html).toContain(en.orders.refund.refunded);
    expect(html).toContain('Oct 19, 2026');
  });

  it('says so when the order is not the user’s or cannot be loaded', async () => {
    stubApi(404, { error: { code: 'not_found', message: 'x' } });
    const html = await renderDetail();
    expect(html).toContain(en.orders.notFound);
    expect(html).not.toContain('receipt/x');
  });
});
