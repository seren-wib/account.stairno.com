import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { registerClient } from '../../src/admin/register-client';
import { createTestApp } from '../helpers/app';
import { PASSWORD, get, post, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

const LABS = {
  name: 'Stairno Labs',
  redirectUris: ['https://stairnolabs.com/api/auth/oauth2/callback/stairno'],
};

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const operator = await signUp(ctx.app);
  const client = await registerClient(ctx.auth, LABS, new Headers({ cookie: operator.cookie }));
  return { ...ctx, operator, client };
}

describe('registerClient', () => {
  it('FR-15 FR-16 registers a first-party web site with a secret', async () => {
    const { db, client } = await setup();

    expect(client.clientId).toBeTruthy();
    expect(client.clientSecret).toBeTruthy();
    const rows = await db.execute(sql`
      select name, redirect_uris, application_type, token_endpoint_auth_method, skip_consent,
             grant_types, require_pkce, user_id, reference_id
      from oauth_client where client_id = ${client.clientId}`);
    expect(rows.rows[0]).toMatchObject({
      name: LABS.name,
      redirect_uris: LABS.redirectUris,
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_post',
      skip_consent: true,
      require_pkce: true,
      user_id: null,
      reference_id: 'stairno',
    });
    expect((rows.rows[0] as { grant_types: string[] }).grant_types.sort()).toEqual(
      ['authorization_code', 'client_credentials', 'refresh_token'].sort(),
    );
  });

  it("FR-15 keeps the site when the operator's account is deleted", async () => {
    const { app, db, operator, client } = await setup();

    await post(app, '/auth/delete-user', { password: PASSWORD }, operator.cookie);

    const rows = await db.execute(
      sql`select count(*)::int as n from oauth_client where client_id = ${client.clientId}`,
    );
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });
});

describe('client registration over HTTP', () => {
  it('FR-15 dynamic client registration is off', async () => {
    const { app } = await createTestApp();

    const res = await post(app, '/auth/oauth2/register', {
      redirect_uris: ['https://evil.example/callback'],
      client_name: 'Evil',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it.each([
    ['/auth/oauth2/create-client', 'POST'],
    ['/auth/oauth2/update-client', 'POST'],
    ['/auth/oauth2/delete-client', 'POST'],
    ['/auth/oauth2/client/rotate-secret', 'POST'],
    ['/auth/oauth2/get-clients', 'GET'],
    ['/auth/oauth2/get-client?client_id=x', 'GET'],
  ])('FR-15 closes %s to signed-in users', async (path, method) => {
    const { app, operator, client } = await setup();

    const res =
      method === 'GET'
        ? await get(app, path, operator.cookie)
        : await post(app, path, { client_id: client.clientId, update: {} }, operator.cookie);

    expect(res.status).toBe(404);
  });

  it('FR-15 does not issue a code for an unregistered client_id', async () => {
    const { app, operator } = await setup();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'not-registered',
      redirect_uri: 'https://evil.example/callback',
      scope: 'openid',
      state: 'xyz',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
    });

    const res = await get(app, `/auth/oauth2/authorize?${query}`, operator.cookie);

    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('https://evil.example')).toBe(false);
    expect(location).not.toContain('code=');
  });
});
