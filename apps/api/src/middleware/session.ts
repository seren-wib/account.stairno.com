import { createMiddleware } from 'hono/factory';
import type { AppEnv, AuthUser } from '../deps';
import { apiError } from '../http/errors';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// FR-13: the caller is the user of a Bearer access token, or else of the session cookie.
// A Bearer token that fails verification is 401; it never falls back to the cookie.
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const { auth } = c.var.deps;
  const authorization = c.req.header('authorization');

  if (authorization?.startsWith('Bearer ')) {
    const context = await auth.$context;
    // Access tokens come from the OIDC provider: issuer `{API_URL}/auth`, audience `{API_URL}`
    // (FR-19). verifyJWT checks the signature against our JWKS, `exp` and the audience.
    const { payload } = await auth.api.verifyJWT({
      body: { token: authorization.slice('Bearer '.length).trim(), issuer: context.baseURL },
    });
    // A site's client-credentials token has no `sub` and is not a user.
    const user = payload?.sub
      ? ((await context.internalAdapter.findUserById(payload.sub)) as AuthUser | null)
      : null;
    if (!user) return apiError(c, 401, 'unauthorized', 'The access token is not valid.');
    c.set('user', user);
    c.set('session', null);
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

// Routes that act on the account center's own session (the device list) need the cookie.
export const requireCookieSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.session) {
    return apiError(c, 401, 'unauthorized', 'This needs the account center session.');
  }
  await next();
});
