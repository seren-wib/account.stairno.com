import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { registerClient } from '../../src/admin/register-client';
import { ACCOUNT_URL, API_URL, createTestApp } from '../helpers/app';
import { createMemoryAvatarBucket } from '../helpers/bucket';
import { get, post, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite } from '../helpers/oidc';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function verifyIdToken(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  token: string,
  aud: string,
) {
  const jwks = (await (await ctx.app.request('/auth/jwks')).json()) as JSONWebKeySet;
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    issuer: `${API_URL}/auth`,
    audience: aud,
  });
  return payload;
}

describe('ID token', () => {
  it('FR-18 FR-78 carries sub, email, email_verified, name and locale, signed by the API', async () => {
    const ctx = await createTestApp();
    const site = await registerLabs(ctx);
    const { email, cookie } = await signUp(ctx.app, { locale: 'en' });
    const me = (await (await get(ctx.app, '/v1/me', cookie)).json()) as { id: string };

    const tokens = await signInToSite(ctx, site, cookie);
    const claims = await verifyIdToken(ctx, tokens.id_token ?? '', site.clientId);

    expect(claims).toMatchObject({
      sub: me.id,
      email,
      email_verified: false,
      name: 'Test User',
      locale: 'en',
    });
  });

  it('FR-84 adds the country and the time zone (zoneinfo) to the profile claims when set', async () => {
    const ctx = await createTestApp();
    const site = await registerLabs(ctx);
    const { cookie } = await signUp(ctx.app, { locale: 'en' });
    await post(ctx.app, '/auth/update-user', { country: 'KR', timezone: 'Asia/Seoul' }, cookie);

    const tokens = await signInToSite(ctx, site, cookie);
    const claims = await verifyIdToken(ctx, tokens.id_token ?? '', site.clientId);

    expect(claims).toMatchObject({ country: 'KR', zoneinfo: 'Asia/Seoul' });
  });

  it('FR-85 gives sites the photo address as the standard picture claim', async () => {
    const ctx = await createTestApp({ avatars: createMemoryAvatarBucket() });
    const site = await registerLabs(ctx);
    const { cookie } = await signUp(ctx.app, { locale: 'en' });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const upload = await ctx.app.request('/v1/me/image', {
      method: 'PUT',
      headers: { 'content-type': 'image/png', origin: ACCOUNT_URL, cookie },
      body: png,
    });
    const { image } = (await upload.json()) as { image: string };

    const tokens = await signInToSite(ctx, site, cookie);
    const claims = await verifyIdToken(ctx, tokens.id_token ?? '', site.clientId);

    expect(claims.picture).toBe(image);
  });

  it('FR-84 leaves both claims out when they are not set', async () => {
    const ctx = await createTestApp();
    const site = await registerLabs(ctx);
    const { cookie } = await signUp(ctx.app, { locale: 'en' });

    const tokens = await signInToSite(ctx, site, cookie);
    const claims = await verifyIdToken(ctx, tokens.id_token ?? '', site.clientId);

    expect(claims).not.toHaveProperty('country');
    expect(claims).not.toHaveProperty('zoneinfo');
  });

  it('FR-18 gives the same sub to every site', async () => {
    const ctx = await createTestApp();
    const labs = await registerLabs(ctx);
    const operator = await signUp(ctx.app);
    const works = {
      ...(await registerClient(
        ctx.auth,
        { name: 'Stairno Works', redirectUris: ['https://stairnoworks.com/api/auth/callback'] },
        new Headers({ cookie: operator.cookie }),
      )),
      redirectUri: 'https://stairnoworks.com/api/auth/callback',
    };
    const { cookie } = await signUp(ctx.app);

    const atLabs = await verifyIdToken(
      ctx,
      (await signInToSite(ctx, labs, cookie)).id_token ?? '',
      labs.clientId,
    );
    const atWorks = await verifyIdToken(
      ctx,
      (await signInToSite(ctx, works, cookie)).id_token ?? '',
      works.clientId,
    );

    expect(atLabs.sub).toBeTruthy();
    expect(atWorks.sub).toBe(atLabs.sub);
  });
});
