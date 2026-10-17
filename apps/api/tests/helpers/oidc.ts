import { createHash, randomBytes } from 'node:crypto';
import { registerClient } from '../../src/admin/register-client';
import type { createTestApp } from './app';
import { signUp } from './auth';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export const LABS_CALLBACK = 'https://stairnolabs.com/api/auth/oauth2/callback/stairno';

// A site registered the way the admin command does it (FR-15), by a throwaway operator.
export async function registerLabs(ctx: TestApp) {
  const operator = await signUp(ctx.app);
  const client = await registerClient(
    ctx.auth,
    { name: 'Stairno Labs', redirectUris: [LABS_CALLBACK] },
    new Headers({ cookie: operator.cookie }),
  );
  return { ...client, redirectUri: LABS_CALLBACK };
}

export type Site = Awaited<ReturnType<typeof registerLabs>>;

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// What a site sends the browser to (SDD §3.5): code flow with PKCE S256.
export function authorizePath(
  site: Site,
  options: { challenge: string; state?: string; scope?: string; resource?: string },
) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: site.clientId,
    redirect_uri: site.redirectUri,
    scope: options.scope ?? 'openid profile email',
    state: options.state ?? 'state-123',
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
  });
  if (options.resource) query.set('resource', options.resource);
  return `/auth/oauth2/authorize?${query}`;
}

// One browser navigation: Better Auth answers a navigation with a 302 and a fetch with JSON.
export async function navigate(app: TestApp['app'], path: string, cookie?: string) {
  const res = await app.request(path, {
    headers: {
      accept: 'text/html',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      ...(cookie ? { cookie } : {}),
    },
  });
  let location = res.headers.get('location');
  if (!location && res.headers.get('content-type')?.includes('json')) {
    const body = (await res.json()) as { redirect?: boolean; url?: string };
    if (body.redirect && body.url) location = body.url;
  }
  return { res, location: location ?? '' };
}

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

// The site's server exchanging a grant at the token endpoint (client_secret_post).
export async function tokenRequest(
  app: TestApp['app'],
  site: Site,
  params: Record<string, string>,
) {
  return app.request('/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: site.clientId,
      client_secret: site.clientSecret,
      ...params,
    }),
  });
}

export function exchangeCode(
  app: TestApp['app'],
  site: Site,
  code: string,
  verifier: string,
  extra: Record<string, string> = {},
) {
  return tokenRequest(app, site, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: site.redirectUri,
    code_verifier: verifier,
    ...extra,
  });
}

// Signed-in user → code → tokens, the whole first-party flow in one call.
export async function signInToSite(
  ctx: TestApp,
  site: Site,
  cookie: string,
  options: { scope?: string; resource?: string } = {},
) {
  const { verifier, challenge } = pkce();
  const { location } = await navigate(
    ctx.app,
    authorizePath(site, { challenge, ...options }),
    cookie,
  );
  const code = new URL(location).searchParams.get('code');
  if (!code) throw new Error(`no code in ${location}`);
  const extra: Record<string, string> = options.resource ? { resource: options.resource } : {};
  const res = await exchangeCode(ctx.app, site, code, verifier, extra);
  return (await res.json()) as TokenResponse;
}
