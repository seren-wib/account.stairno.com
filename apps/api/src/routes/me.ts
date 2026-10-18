import { Hono } from 'hono';
import type { AppEnv } from '../deps';
import { requireUser } from '../middleware/session';

// FR-23: the signed-in user, with exactly these fields (NFR-9 keeps the rest inside the API).
export const meRoutes = new Hono<AppEnv>().use(requireUser).get('/', (c) => {
  const { user } = c.var;
  return c.json({
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    locale: user.locale,
    createdAt: new Date(user.createdAt).toISOString(),
  });
});
