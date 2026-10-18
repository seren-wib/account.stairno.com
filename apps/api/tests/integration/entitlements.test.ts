import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, registerSite, signInToSite, siteToken } from '../helpers/oidc';

// FR-58 to FR-61: a site asks what its signed-in user may use, with the user's access token.
// The answer may be cached for a minute by the site, for that user only.

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

function product(clientId: string, sku: string, change: Record<string, unknown> = {}) {
  return {
    sku,
    clientId,
    nameKo: sku,
    nameEn: sku,
    kind: 'one_time',
    prices: [{ currency: 'KRW', amount: 12000 }],
    ...change,
  };
}

async function setup() {
  const ctx = await createTestApp();
  const site = await registerLabs(ctx);
  const user = await signUp(ctx.app);
  const [row] = await all<{ id: string }>(
    ctx.db,
    sql`select id from "user" where email = ${user.email}`,
  );
  await addProduct(
    ctx.db,
    product(site.clientId, 'atlas-desktop', { downloadKey: 'atlas/1.0.zip' }),
  );
  await addProduct(
    ctx.db,
    product(site.clientId, 'atlas-pro', { kind: 'subscription', interval: 'month' }),
  );
  await addProduct(
    ctx.db,
    product(site.clientId, 'atlas-free', {
      kind: 'subscription',
      interval: 'month',
      prices: [{ currency: 'KRW', amount: 0 }],
    }),
  );
  const userToken = (await signInToSite(ctx, site, user.cookie, { resource: API_URL }))
    .access_token;
  const ask = (sku: string | undefined, token: string = userToken) =>
    ctx.app.request(`/v1/entitlements${sku === undefined ? '' : `?sku=${sku}`}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  const grant = (sku: string, change: { status?: string; expiresIn?: string | null } = {}) =>
    ctx.db.execute(sql`
      insert into entitlement (user_id, product_id, status, expires_at, downloadable)
      select ${row!.id}, p.id, ${change.status ?? 'active'},
             case when ${change.expiresIn ?? null}::text is null then null
                  else now() + ${change.expiresIn ?? '0'}::interval end,
             p.download_key is not null
      from product p where p.sku = ${sku}`);
  const addCard = () =>
    ctx.db.execute(sql`
      insert into payment_method (user_id, provider, billing_key, customer_key, is_default)
      values (${row!.id}, 'toss', 'v1.not.used', 'cus_test', true)`);
  return { ...ctx, site, user, userId: row!.id, userToken, ask, grant, addCard };
}

describe('GET /v1/entitlements?sku=', () => {
  it('FR-59 FR-60 answers a purchase as active for good, downloadable, cacheable for a minute', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-desktop');

    const res = await ctx.ask('atlas-desktop');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    expect(await res.json()).toEqual({
      sku: 'atlas-desktop',
      status: 'active',
      active: true,
      expiresAt: null,
      downloadable: true,
    });
  });

  it('FR-59 FR-61 answers a subscription as active until its end, then expired', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-pro', { expiresIn: '10 days' });

    const running = (await (await ctx.ask('atlas-pro')).json()) as Record<string, unknown>;
    expect(running).toMatchObject({ status: 'active', active: true, downloadable: false });
    expect(new Date(running.expiresAt as string).getTime()).toBeGreaterThan(Date.now());

    await ctx.db.execute(sql`update entitlement set expires_at = now() - interval '1 minute'`);
    expect(await (await ctx.ask('atlas-pro')).json()).toMatchObject({
      status: 'expired',
      active: false,
    });
  });

  it('FR-61 answers a refunded purchase as revoked', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-desktop', { status: 'revoked' });

    expect(await (await ctx.ask('atlas-desktop')).json()).toMatchObject({
      status: 'revoked',
      active: false,
    });
  });

  it('FR-60 answers none when the user never had it', async () => {
    const ctx = await setup();

    expect(await (await ctx.ask('atlas-desktop')).json()).toEqual({
      sku: 'atlas-desktop',
      status: 'none',
      active: false,
      expiresAt: null,
      downloadable: false,
    });
  });

  it('FR-58 gives a free plan to a user with a card and asks for one otherwise', async () => {
    const ctx = await setup();

    expect(await (await ctx.ask('atlas-free')).json()).toMatchObject({
      status: 'requires_payment_method',
      active: false,
    });

    await ctx.addCard();

    expect(await (await ctx.ask('atlas-free')).json()).toEqual({
      sku: 'atlas-free',
      status: 'active',
      active: true,
      expiresAt: null,
      downloadable: false,
    });
  });

  it('FR-60 shows a site only its own products', async () => {
    const ctx = await setup();
    const works = await registerSite(
      ctx,
      'Stairno Works',
      'https://stairnoworks.com/auth/callback',
    );
    await addProduct(ctx.db, product(works.clientId, 'works-retainer'));
    await ctx.grant('works-retainer');

    const res = await ctx.ask('works-retainer');

    expect(res.status).toBe(404);
  });

  it('FR-60 answers the account center session for any product', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-desktop');

    const res = await get(ctx.app, '/v1/entitlements?sku=atlas-desktop', ctx.user.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'active' });
  });

  it('FR-60 answers 404 for an unknown product and 422 without a sku', async () => {
    const ctx = await setup();

    expect((await ctx.ask('nothing-here')).status).toBe(404);
    const missing = await ctx.ask(undefined);
    expect(missing.status).toBe(422);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
  });

  it('SDD §8 is about a user, so a site’s own token is refused', async () => {
    const ctx = await setup();

    expect((await ctx.ask('atlas-desktop', await siteToken(ctx, ctx.site))).status).toBe(403);
  });
});
