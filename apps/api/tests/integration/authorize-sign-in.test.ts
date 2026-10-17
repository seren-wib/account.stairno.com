import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_URL, API_URL, createTestApp } from '../helpers/app';
import { PASSWORD, post, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { authorizePath, navigate, pkce, registerLabs } from '../helpers/oidc';

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const ctx = await createTestApp();
  const site = await registerLabs(ctx);
  // The person has an account but this browser has no session yet.
  const { email } = await signUp(ctx.app);
  const { challenge } = pkce();
  const { location } = await navigate(
    ctx.app,
    authorizePath(site, { challenge, state: 'from-labs' }),
  );
  return { ...ctx, site, email, signInPage: new URL(location) };
}

// Follows the provider's own hops (authorize, continue) until the browser leaves the API.
async function follow(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  url: string,
  cookie: string,
) {
  let next = url;
  for (let hop = 0; hop < 3 && next.startsWith(API_URL); hop++) {
    const target = new URL(next);
    next = (await navigate(app, `${target.pathname}${target.search}`, cookie)).location;
  }
  return next;
}

describe('sign-in during authorize', () => {
  it('FR-17 sends a signed-out authorize request to the account center sign-in page', async () => {
    const { signInPage, site } = await setup();

    expect(`${signInPage.origin}${signInPage.pathname}`).toBe(`${ACCOUNT_URL}/sign-in`);
    expect(signInPage.searchParams.get('client_id')).toBe(site.clientId);
    expect(signInPage.searchParams.get('sig')).toBeTruthy();
  });

  it('FR-17 signing in with the forwarded query continues to the site callback', async () => {
    const { app, email, site, signInPage } = await setup();

    const res = await post(app, '/auth/sign-in/email', {
      email,
      password: PASSWORD,
      oauth_query: signInPage.search.slice(1),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { url?: string };
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const landed = new URL(await follow(app, new URL(body.url ?? '', API_URL).href, cookie));
    expect(`${landed.origin}${landed.pathname}`).toBe(site.redirectUri);
    expect(landed.searchParams.get('code')).toBeTruthy();
    expect(landed.searchParams.get('state')).toBe('from-labs');
  });

  it('FR-17 does not continue with a tampered authorization query', async () => {
    const { app, email, site, signInPage } = await setup();
    const tampered = new URLSearchParams(signInPage.search);
    tampered.set('state', 'changed-by-attacker');

    const res = await post(app, '/auth/sign-in/email', {
      email,
      password: PASSWORD,
      oauth_query: tampered.toString(),
    });

    const body = (await res.json().catch(() => ({}))) as { url?: string };
    expect(String(body.url ?? '').startsWith(site.redirectUri)).toBe(false);
  });
});
