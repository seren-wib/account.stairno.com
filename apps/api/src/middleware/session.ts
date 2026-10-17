import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../deps';
import { apiError } from '../http/errors';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// The signed-in user from the session cookie, or 401 (FR-24). Bearer tokens come with FR-13.
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const { auth } = c.var.deps;
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

  c.set('session', session);
  await next();
});
