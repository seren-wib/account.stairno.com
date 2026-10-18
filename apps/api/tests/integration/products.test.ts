import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { createTestApp } from '../helpers/app';
import { get, signIn, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs } from '../helpers/oidc';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

async function setup(overrides: Parameters<typeof createTestApp>[0] = {}) {
  const ctx = await createTestApp(overrides);
  const site = await registerLabs(ctx);
  const buyer = await signUp(ctx.app);
  return { ...ctx, site, buyer };
}

function desktop(clientId: string) {
  return {
    sku: 'atlas-odyssey-desktop',
    clientId,
    nameKo: '아틀라스 오디세이 데스크톱',
    nameEn: 'Atlas Odyssey Desktop',
    kind: 'one_time' as const,
    prices: [
      { currency: 'KRW', amount: 12000 },
      { currency: 'USD', amount: 900 },
    ],
    downloadKey: 'atlas-odyssey/1.0.0/setup.exe',
  };
}

async function count(db: Ctx['db'], table: 'product' | 'product_price') {
  const { rows } = await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  return (rows[0] as { n: number }).n;
}

describe('addProduct', () => {
  it('FR-34 registers a product with one integer price per currency', async () => {
    const { db, site } = await setup();

    const product = await addProduct(db, desktop(site.clientId));

    expect(product).toMatchObject({ sku: 'atlas-odyssey-desktop', id: expect.any(String) });
    const { rows } = await db.execute(
      sql`select currency, amount from product_price where product_id = ${product.id} order by currency`,
    );
    expect(rows).toEqual([
      { currency: 'KRW', amount: 12000 },
      { currency: 'USD', amount: 900 },
    ]);
  });

  it('FR-34 FR-58 registers a free subscription with its interval', async () => {
    const { db, site } = await setup();

    await expect(
      addProduct(db, {
        sku: 'atlas-odyssey-free',
        clientId: site.clientId,
        nameKo: '아틀라스 오디세이 무료',
        nameEn: 'Atlas Odyssey Free',
        kind: 'subscription',
        interval: 'month',
        prices: [{ currency: 'KRW', amount: 0 }],
      }),
    ).resolves.toMatchObject({ sku: 'atlas-odyssey-free' });
  });

  it.each([
    ['a subscription without an interval', { kind: 'subscription' }],
    ['a one-time product with an interval', { interval: 'month' }],
    ['no prices', { prices: [] }],
    [
      'two prices in one currency',
      {
        prices: [
          { currency: 'KRW', amount: 12000 },
          { currency: 'KRW', amount: 13000 },
        ],
      },
    ],
    ['a fractional amount', { prices: [{ currency: 'USD', amount: 8.99 }] }],
    ['a negative amount', { prices: [{ currency: 'KRW', amount: -1 }] }],
    ['a currency we do not take', { prices: [{ currency: 'EUR', amount: 900 }] }],
    ['a sku with spaces', { sku: 'Atlas Odyssey' }],
  ])('FR-34 DR-5 DR-9 rejects %s and writes nothing', async (_, change) => {
    const { db, site } = await setup();

    await expect(addProduct(db, { ...desktop(site.clientId), ...change })).rejects.toThrow();

    expect(await count(db, 'product')).toBe(0);
    expect(await count(db, 'product_price')).toBe(0);
  });

  it('FR-34 rejects a site that is not registered', async () => {
    const { db } = await setup();

    await expect(addProduct(db, desktop('not-a-site'))).rejects.toThrow();
    expect(await count(db, 'product')).toBe(0);
  });

  it('FR-34 registers a sku once', async () => {
    const { db, site } = await setup();
    await addProduct(db, desktop(site.clientId));

    await expect(addProduct(db, desktop(site.clientId))).rejects.toThrow();
    expect(await count(db, 'product')).toBe(1);
    expect(await count(db, 'product_price')).toBe(2);
  });
});

describe('GET /v1/products/{sku}', () => {
  it('FR-34 shows an active product with its names and prices', async () => {
    const { app, db, site, buyer } = await setup();
    await addProduct(db, desktop(site.clientId));

    const res = await get(app, '/v1/products/atlas-odyssey-desktop', buyer.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sku: 'atlas-odyssey-desktop',
      name: { ko: '아틀라스 오디세이 데스크톱', en: 'Atlas Odyssey Desktop' },
      kind: 'one_time',
      interval: null,
      downloadable: true,
      prices: [
        { currency: 'KRW', amount: 12000 },
        { currency: 'USD', amount: 900 },
      ],
    });
  });

  it('FR-34 FR-62 never shows where the download is stored', async () => {
    const { app, db, site, buyer } = await setup();
    await addProduct(db, desktop(site.clientId));

    const res = await get(app, '/v1/products/atlas-odyssey-desktop', buyer.cookie);

    expect(JSON.stringify(await res.json())).not.toContain('setup.exe');
  });

  it('FR-34 FR-24 answers 404 for an unknown or inactive product', async () => {
    const { app, db, site, buyer } = await setup();
    await addProduct(db, desktop(site.clientId));
    await db.execute(sql`update product set active = false`);

    for (const sku of ['atlas-odyssey-desktop', 'no-such-product']) {
      const res = await get(app, `/v1/products/${sku}`, buyer.cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
    }
  });

  it('FR-13 asks for a signed-in caller', async () => {
    const { app } = await setup();

    const res = await get(app, '/v1/products/atlas-odyssey-desktop');

    expect(res.status).toBe(401);
  });

  it('FR-42 NFR-11 still answers, and sign-in still works, when payments are off', async () => {
    const { app, db, site, buyer } = await setup({ paymentsMode: 'off' });
    await addProduct(db, desktop(site.clientId));

    expect((await signIn(app, buyer.email)).res.status).toBe(200);
    expect((await get(app, '/v1/products/atlas-odyssey-desktop', buyer.cookie)).status).toBe(200);
  });
});
