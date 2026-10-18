import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, siteToken } from '../helpers/oidc';

// FR-62, FR-29: the account center lists the desktop products the user may download now, from
// every site. Each one then asks POST /v1/downloads for its link.

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

async function setup() {
  const ctx = await createTestApp();
  const site = await registerLabs(ctx);
  const base = { clientId: site.clientId, prices: [{ currency: 'KRW', amount: 12000 }] };
  for (const [sku, kind, downloadKey] of [
    ['atlas-desktop', 'one_time', 'atlas/1.0.zip'],
    ['atlas-pro', 'subscription', 'atlas/pro.zip'],
    ['atlas-old', 'one_time', 'atlas/old.zip'],
    ['atlas-gone', 'subscription', 'atlas/gone.zip'],
    ['atlas-web', 'one_time', undefined],
  ] as const) {
    await addProduct(ctx.db, {
      ...base,
      sku,
      nameKo: `${sku} ko`,
      nameEn: `${sku} en`,
      kind,
      ...(kind === 'subscription' ? { interval: 'month' } : {}),
      ...(downloadKey ? { downloadKey } : {}),
    });
  }
  const user = await signUp(ctx.app);
  const other = await signUp(ctx.app);
  const idOf = async (email: string) =>
    (await all<{ id: string }>(ctx.db, sql`select id from "user" where email = ${email}`))[0]!.id;
  const userId = await idOf(user.email);
  const grant = (sku: string, status: string, expires: string | null, who = userId) =>
    ctx.db.execute(sql`
      insert into entitlement (user_id, product_id, status, expires_at, downloadable)
      select ${who}, p.id, ${status},
             case when ${expires}::text is null then null else now() + ${expires ?? '0'}::interval end,
             p.download_key is not null
      from product p where p.sku = ${sku}`);
  return { ...ctx, site, user, other, userId, otherId: await idOf(other.email), grant };
}

describe('GET /v1/me/downloads', () => {
  it('FR-62 lists what the user may download now, and nothing else', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-desktop', 'active', null);
    await ctx.grant('atlas-pro', 'active', '10 days');
    await ctx.grant('atlas-old', 'revoked', null);
    await ctx.grant('atlas-gone', 'active', '-1 day');
    await ctx.grant('atlas-web', 'active', null);
    await ctx.grant('atlas-desktop', 'active', null, ctx.otherId);

    const res = await get(ctx.app, '/v1/me/downloads', ctx.user.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [
        {
          sku: 'atlas-desktop',
          name: { ko: 'atlas-desktop ko', en: 'atlas-desktop en' },
          expiresAt: null,
        },
        {
          sku: 'atlas-pro',
          name: { ko: 'atlas-pro ko', en: 'atlas-pro en' },
          expiresAt: expect.any(String),
        },
      ],
      nextCursor: null,
    });
  });

  it('FR-62 is empty for a user who owns nothing to download', async () => {
    const ctx = await setup();

    expect(await (await get(ctx.app, '/v1/me/downloads', ctx.user.cookie)).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('SDD §8 only the account center session, not a site or a token the user gave a site', async () => {
    const ctx = await setup();
    const userToken = (await signInToSite(ctx, ctx.site, ctx.user.cookie, { resource: API_URL }))
      .access_token;
    const bearer = (token: string) =>
      ctx.app.request('/v1/me/downloads', { headers: { authorization: `Bearer ${token}` } });

    expect((await bearer(userToken)).status).toBe(401);
    expect((await bearer(await siteToken(ctx, ctx.site))).status).toBe(403);
  });
});
