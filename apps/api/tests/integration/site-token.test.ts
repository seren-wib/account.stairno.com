import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { addProduct } from '../../src/admin/add-product';
import { API_URL, createTestApp } from '../helpers/app';
import { signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, siteToken, tokenRequest } from '../helpers/oidc';

// SDD §8: three kinds of caller. This file is about the second one, a site's server calling the
// API with its own client-credentials token (FR-35).

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const site = await registerLabs(ctx);
  return { ...ctx, site };
}

function bearer(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  path: string,
  token: string,
) {
  return app.request(path, { headers: { authorization: `Bearer ${token}` } });
}

describe('site access token', () => {
  it('FR-35 FR-19 is a JWT for the API that names the site as subject and party', async () => {
    const ctx = await setup();
    const token = await siteToken(ctx, ctx.site);
    const jwks = (await (await ctx.app.request('/auth/jwks')).json()) as JSONWebKeySet;

    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: `${API_URL}/auth`,
      audience: API_URL,
    });

    expect(payload).toMatchObject({
      sub: ctx.site.clientId,
      azp: ctx.site.clientId,
      scope: 'commerce',
    });
  });

  it('FR-35 is refused to a wrong client secret', async () => {
    const ctx = await setup();

    const res = await tokenRequest(
      ctx.app,
      { ...ctx.site, clientSecret: 'wrong' },
      { grant_type: 'client_credentials', resource: API_URL },
    );

    // RFC 6749 §5.2: 400 invalid_client for credentials sent in the body.
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('FR-13 is not a user', async () => {
    const ctx = await setup();
    const token = await siteToken(ctx, ctx.site);

    for (const path of ['/v1/me', '/v1/sessions', '/v1/connections']) {
      expect((await bearer(ctx.app, path, token)).status, path).toBe(403);
    }
  });

  it('FR-34 reads products', async () => {
    const ctx = await setup();
    await addProduct(ctx.db, {
      sku: 'atlas-odyssey-desktop',
      clientId: ctx.site.clientId,
      nameKo: '아틀라스 오디세이 데스크톱',
      nameEn: 'Atlas Odyssey Desktop',
      kind: 'one_time',
      prices: [{ currency: 'KRW', amount: 12000 }],
    });

    const res = await bearer(
      ctx.app,
      '/v1/products/atlas-odyssey-desktop',
      await siteToken(ctx, ctx.site),
    );

    expect(res.status).toBe(200);
  });

  it('FR-15 stops working when the site is disabled', async () => {
    const ctx = await setup();
    const token = await siteToken(ctx, ctx.site);
    // Disabled in the database, as the operator would; there is no HTTP route for it.
    await ctx.db.execute(
      sql`update oauth_client set disabled = true where client_id = ${ctx.site.clientId}`,
    );

    expect((await bearer(ctx.app, '/v1/products/anything', token)).status).toBe(401);
  });

  it('FR-13 FR-23 leaves the signed-in user as before', async () => {
    const ctx = await setup();
    const { cookie } = await signUp(ctx.app);

    const res = await ctx.app.request('/v1/me', { headers: { cookie } });

    expect(res.status).toBe(200);
  });
});
