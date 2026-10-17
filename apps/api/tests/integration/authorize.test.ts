import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { authorizePath, exchangeCode, navigate, pkce, registerLabs } from '../helpers/oidc';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const site = await registerLabs(ctx);
  const user = await signUp(ctx.app);
  return { ...ctx, site, user };
}

describe('first-party authorize', () => {
  it('FR-16 sends a signed-in user straight back to the site with a code, no consent', async () => {
    const { app, site, user } = await setup();
    const { challenge } = pkce();

    const { res, location } = await navigate(
      app,
      authorizePath(site, { challenge, state: 'from-labs' }),
      user.cookie,
    );

    expect(res.status).toBe(302);
    const callback = new URL(location);
    expect(`${callback.origin}${callback.pathname}`).toBe(site.redirectUri);
    expect(callback.searchParams.get('code')).toBeTruthy();
    expect(callback.searchParams.get('state')).toBe('from-labs');
  });

  it('FR-14 FR-16 exchanges the code with the PKCE verifier for tokens', async () => {
    const { app, site, user } = await setup();
    const { verifier, challenge } = pkce();
    const { location } = await navigate(app, authorizePath(site, { challenge }), user.cookie);
    const code = new URL(location).searchParams.get('code') ?? '';

    const res = await exchangeCode(app, site, code, verifier);

    expect(res.status).toBe(200);
    const tokens = (await res.json()) as { access_token?: string; id_token?: string };
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.id_token).toBeTruthy();
  });

  it('FR-14 refuses the code with a wrong PKCE verifier', async () => {
    const { app, site, user } = await setup();
    const { challenge } = pkce();
    const { location } = await navigate(app, authorizePath(site, { challenge }), user.cookie);
    const code = new URL(location).searchParams.get('code') ?? '';

    const res = await exchangeCode(app, site, code, pkce().verifier);

    expect(res.status).toBe(400);
  });

  it('FR-16 refuses a redirect_uri the site did not register', async () => {
    const { app, site, user } = await setup();
    const { challenge } = pkce();
    const path = authorizePath(
      { ...site, redirectUri: 'https://evil.example/callback' },
      {
        challenge,
      },
    );

    const { location } = await navigate(app, path, user.cookie);

    expect(location.startsWith('https://evil.example')).toBe(false);
    expect(location).not.toContain('code=');
  });
});
