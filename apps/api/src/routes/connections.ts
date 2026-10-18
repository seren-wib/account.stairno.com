import { Hono } from 'hono';
import { sql, type SQL } from 'drizzle-orm';
import type { AppEnv, Deps } from '../deps';
import { apiError } from '../http/errors';
import { requireCookieSession, requireUser } from '../middleware/session';

interface ConnectionRow {
  client_id: string;
  name: string | null;
  connected_ms: string | number;
  last_used_ms: string | number;
}

// neon-http and PGlite both return `{ rows }` from execute().
async function rows<T>(db: Deps['db'], query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

// Better Auth's timestamps are `timestamp` without time zone holding UTC. Epoch reads them as UTC
// on any database session, and `now() at time zone 'UTC'` compares like with like.
const UTC_NOW = sql`(now() at time zone 'UTC')`;

// FR-21: a site is connected while it holds a token that can still act for the user, an unrevoked
// unexpired refresh token or stored access token. First-party sites skip consent, so consents are
// not the record of a connection; a JWT-only sign-in expires within the hour by itself.
function liveTokens(userId: string) {
  return sql`
    select client_id, created_at from oauth_refresh_token
      where user_id = ${userId} and revoked is null and expires_at > ${UTC_NOW}
    union all
    select client_id, created_at from oauth_access_token
      where user_id = ${userId} and revoked is null and expires_at > ${UTC_NOW}`;
}

export const connectionRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .use(requireCookieSession)
  .get('/', async (c) => {
    const items = await rows<ConnectionRow>(
      c.var.deps.db,
      sql`
        select t.client_id, c.name,
               extract(epoch from min(t.created_at)) * 1000 as connected_ms,
               extract(epoch from max(t.created_at)) * 1000 as last_used_ms
        from (${liveTokens(c.var.user.id)}) t
        join oauth_client c on c.client_id = t.client_id
        group by t.client_id, c.name
        order by max(t.created_at) desc`,
    );
    return c.json({
      items: items.map((r) => ({
        clientId: r.client_id,
        name: r.name ?? r.client_id,
        connectedAt: new Date(Number(r.connected_ms)).toISOString(),
        lastUsedAt: new Date(Number(r.last_used_ms)).toISOString(),
      })),
      nextCursor: null,
    });
  })
  .delete('/:clientId', async (c) => {
    const { db } = c.var.deps;
    const userId = c.var.user.id;
    const clientId = c.req.param('clientId');
    const live = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from (${liveTokens(userId)}) t where t.client_id = ${clientId}`,
    );
    if (!live[0]?.n) return apiError(c, 404, 'not_found', 'This site is not connected.');

    // Access tokens first: they reference the refresh token they came from.
    await db.execute(
      sql`delete from oauth_access_token where user_id = ${userId} and client_id = ${clientId}`,
    );
    await db.execute(
      sql`delete from oauth_refresh_token where user_id = ${userId} and client_id = ${clientId}`,
    );
    await db.execute(
      sql`delete from oauth_consent where user_id = ${userId} and client_id = ${clientId}`,
    );
    return c.body(null, 204);
  });
