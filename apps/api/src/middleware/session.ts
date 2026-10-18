import { createMiddleware } from 'hono/factory';
import { sql } from 'drizzle-orm';
import type { AppEnv, AuthUser, Deps, SitePrincipal } from '../deps';
import { apiError } from '../http/errors';
import { originsOf } from '../lib/origins';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export interface AccessTokenClaims {
  sub: string;
  // The site the token was issued to; our provider always sets it
  azp: string | null;
}

// FR-19: an access token from our OIDC provider: issuer `{API_URL}/auth`, audience `{API_URL}`.
// verifyJWT checks the signature against our JWKS, `exp` and the audience. null when not valid.
export async function verifyAccessToken(
  auth: Deps['auth'],
  token: string,
): Promise<AccessTokenClaims | null> {
  const context = await auth.$context;
  const { payload } = await auth.api.verifyJWT({
    body: { token: token.trim(), issuer: context.baseURL },
  });
  if (typeof payload?.sub !== 'string') return null;
  return { sub: payload.sub, azp: typeof payload.azp === 'string' ? payload.azp : null };
}

async function findSite(db: Deps['db'], clientId: string): Promise<SitePrincipal | null> {
  const result = (await db.execute(sql`
    select redirect_uris from oauth_client
    where client_id = ${clientId} and coalesce(disabled, false) = false`)) as {
    rows: { redirect_uris: string[] }[];
  };
  const [row] = result.rows;
  return row ? { clientId, origins: originsOf(row.redirect_uris) } : null;
}

// SDD §8: who is calling. A Bearer token is a site's own client-credentials token when its subject
// is the client it was issued to (sub = azp, FR-35), and a user's token otherwise (FR-13). Without
// a Bearer token, the account center's session cookie. A Bearer token that fails verification is
// 401; it never falls back to the cookie.
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const { auth, db } = c.var.deps;
  const authorization = c.req.header('authorization');
  c.set('site', null);
  c.set('tokenClient', null);

  if (authorization?.startsWith('Bearer ')) {
    const claims = await verifyAccessToken(auth, authorization.slice('Bearer '.length));
    if (!claims) return apiError(c, 401, 'unauthorized', 'The access token is not valid.');

    if (claims.sub === claims.azp) {
      // A disabled or removed site loses access at once, not when its token runs out.
      const site = await findSite(db, claims.sub);
      if (!site) return apiError(c, 401, 'unauthorized', 'The access token is not valid.');
      c.set('site', site);
      c.set('session', null);
      return next();
    }

    const context = await auth.$context;
    const user = (await context.internalAdapter.findUserById(claims.sub)) as AuthUser | null;
    if (!user) return apiError(c, 401, 'unauthorized', 'The access token is not valid.');
    c.set('user', user);
    c.set('session', null);
    c.set('tokenClient', claims.azp);
    return next();
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return apiError(c, 401, 'unauthorized', 'Sign in to continue.');

  // NFR-5: a cookie rides along on any same-site request, so state changes must also come from
  // a trusted origin (the account center), like Better Auth's own endpoints.
  if (!SAFE_METHODS.includes(c.req.method)) {
    const origin = c.req.header('origin');
    const context = await auth.$context;
    if (!origin || !context.isTrustedOrigin(origin)) {
      return apiError(c, 403, 'forbidden', 'This origin cannot change the account.');
    }
  }

  c.set('user', session.user);
  c.set('session', session.session);
  await next();
});

// Routes about the user's own account (FR-13). A site's token is not a user.
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) return apiError(c, 403, 'forbidden', 'This needs a signed-in user.');
  await next();
});

// Routes a site calls from its server: orders and the rest of commerce (FR-35, FR-40).
export const requireSite = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.site) return apiError(c, 403, 'forbidden', "This needs the site's own token.");
  await next();
});

// Routes that act on the account center's own session (the device list) need the cookie.
export const requireCookieSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.session) {
    return apiError(c, 401, 'unauthorized', 'This needs the account center session.');
  }
  await next();
});
