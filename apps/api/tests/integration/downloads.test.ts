import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { ACCOUNT_URL, API_URL, createTestApp } from '../helpers/app';
import { signUp } from '../helpers/auth';
import { createMemoryBucket } from '../helpers/bucket';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, siteToken } from '../helpers/oidc';

// FR-62 (SDD §6.8): a user who owns a desktop product asks for its file and gets a link that
// works for ten minutes. An R2 binding cannot presign, so the link points at the API, signed with
// a key only the API has, and the API streams the file from R2.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

async function all<T>(db: Ctx['db'], query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

async function setup() {
  const downloads = createMemoryBucket();
  downloads.put('atlas/atlas-1.0.zip', 'the build', 'application/zip');
  const ctx = await createTestApp({ downloads });
  const site = await registerLabs(ctx);
  const user = await signUp(ctx.app);
  const [row] = await all<{ id: string }>(
    ctx.db,
    sql`select id from "user" where email = ${user.email}`,
  );
  const base = {
    clientId: site.clientId,
    kind: 'one_time',
    prices: [{ currency: 'KRW', amount: 12000 }],
  };
  await addProduct(ctx.db, {
    ...base,
    sku: 'atlas-desktop',
    nameKo: '아틀라스',
    nameEn: 'Atlas',
    downloadKey: 'atlas/atlas-1.0.zip',
  });
  await addProduct(ctx.db, { ...base, sku: 'atlas-web', nameKo: '웹', nameEn: 'Web' });
  await addProduct(ctx.db, {
    ...base,
    sku: 'atlas-gone',
    nameKo: '없음',
    nameEn: 'Gone',
    downloadKey: 'atlas/missing.zip',
  });
  const userToken = (await signInToSite(ctx, site, user.cookie, { resource: API_URL }))
    .access_token;
  const grant = (sku: string, change: { status?: string; expired?: boolean } = {}) =>
    ctx.db.execute(sql`
      insert into entitlement (user_id, product_id, status, expires_at, downloadable)
      select ${row!.id}, p.id, ${change.status ?? 'active'},
             case when ${change.expired ?? false} then now() - interval '1 day' else null end,
             p.download_key is not null
      from product p where p.sku = ${sku}`);
  const ask = (sku: string, token: string = userToken) =>
    ctx.app.request('/v1/downloads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ sku }),
    });
  const link = async (sku = 'atlas-desktop') => {
    const res = await ask(sku);
    expect(res.status).toBe(201);
    return (await res.json()) as { url: string; expiresAt: string };
  };
  const fetchLink = (url: string) => ctx.app.request(new URL(url).pathname);
  return { ...ctx, downloads, site, user, userToken, grant, ask, link, fetchLink };
}

describe('POST /v1/downloads', () => {
  it('FR-62 gives an owner a link for ten minutes that streams the file', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-desktop');

    const { url, expiresAt } = await ctx.link();

    const minutes = (new Date(expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9.9);
    expect(minutes).toBeLessThanOrEqual(10);
    expect(url).not.toContain(ctx.user.email);
    expect(url).not.toContain('atlas-1.0.zip');

    const file = await ctx.fetchLink(url);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe('the build');
    expect(file.headers.get('content-type')).toBe('application/zip');
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="atlas-1.0.zip"');
    expect(file.headers.get('cache-control')).toBe('private, no-store');
  });

  it('FR-62 refuses a user who does not own it, or whose subscription ran out or was refunded', async () => {
    const ctx = await setup();
    expect((await ctx.ask('atlas-desktop')).status).toBe(403);

    await ctx.grant('atlas-desktop', { expired: true });
    expect((await ctx.ask('atlas-desktop')).status).toBe(403);

    await ctx.db.execute(sql`update entitlement set expires_at = null, status = 'revoked'`);
    expect((await ctx.ask('atlas-desktop')).status).toBe(403);
    expect(ctx.downloads.reads).toEqual([]);
  });

  it('FR-62 has nothing to download for a product without a file', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-web');

    const res = await ctx.ask('atlas-web');

    expect(res.status).toBe(404);
  });

  it('FR-62 stops working after ten minutes', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-desktop');
    const { url } = await ctx.link();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1_000);

    expect((await ctx.fetchLink(url)).status).toBe(403);
  });

  it('FR-62 refuses a link that was changed', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-desktop');
    const { url } = await ctx.link();
    const [payload, signature] = new URL(url).pathname.split('/').pop()!.split('.');
    const forged = JSON.stringify({ k: 'atlas/other.zip', e: Date.now() + 600_000 });
    const tampered = `${API_URL}/downloads/${btoa(forged).replace(/=+$/, '')}.${signature}`;

    expect((await ctx.fetchLink(tampered)).status).toBe(403);
    expect((await ctx.fetchLink(`${API_URL}/downloads/${payload}.AAAA`)).status).toBe(403);
    expect((await ctx.fetchLink(`${API_URL}/downloads/nonsense`)).status).toBe(403);
    expect(ctx.downloads.reads).toEqual([]);
  });

  it('FR-62 answers 404 when the file is not in the bucket', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-gone');
    const { url } = await ctx.link('atlas-gone');

    expect((await ctx.fetchLink(url)).status).toBe(404);
  });

  it('FR-62 NFR-5 serves the account center session too, from its own origin', async () => {
    const ctx = await setup();
    await ctx.grant('atlas-desktop');
    const send = (origin: string) =>
      ctx.app.request('/v1/downloads', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ctx.user.cookie, origin },
        body: JSON.stringify({ sku: 'atlas-desktop' }),
      });

    expect((await send(ACCOUNT_URL)).status).toBe(201);
    expect((await send('https://evil.example')).status).toBe(403);
  });

  it('SDD §8 is for a user, not a site’s own token, and needs a sku', async () => {
    const ctx = await setup();

    expect((await ctx.ask('atlas-desktop', await siteToken(ctx, ctx.site))).status).toBe(403);
    const missing = await ctx.app.request('/v1/downloads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.userToken}` },
      body: '{}',
    });
    expect(missing.status).toBe(422);
  });
});
