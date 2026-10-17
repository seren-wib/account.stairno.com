import { Hono } from 'hono';
import type { AppEnv } from '../deps';
import { apiError } from '../http/errors';
import { summarizeUserAgent } from '../lib/user-agent';
import { requireCookieSession } from '../middleware/session';

// FR-7: the signed-in devices. Better Auth identifies sessions by token; the token stays here
// and the account center only ever sees the session id.
export const sessionRoutes = new Hono<AppEnv>()
  .use(requireCookieSession)
  .get('/', async (c) => {
    const sessions = await c.var.deps.auth.api.listSessions({ headers: c.req.raw.headers });
    const currentId = c.var.session?.id;
    return c.json({
      items: sessions.map((s) => ({
        id: s.id,
        createdAt: new Date(s.createdAt).toISOString(),
        // Better Auth refreshes this at most once a day (session updateAge, FR-11).
        lastUsedAt: new Date(s.updatedAt).toISOString(),
        ...summarizeUserAgent(s.userAgent),
        current: s.id === currentId,
      })),
      nextCursor: null,
    });
  })
  .delete('/:id', async (c) => {
    const { auth } = c.var.deps;
    const headers = c.req.raw.headers;
    const target = (await auth.api.listSessions({ headers })).find(
      (s) => s.id === c.req.param('id'),
    );
    if (!target) return apiError(c, 404, 'not_found', 'No such session.');
    await auth.api.revokeSession({ headers, body: { token: target.token } });
    return c.body(null, 204);
  });
