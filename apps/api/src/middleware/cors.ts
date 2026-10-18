import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv, Deps } from '../deps';
import type { Env } from '../env';
import { isAllowedOrigin, originsOf } from '../lib/origins';

const SITE_ORIGINS_TTL_MS = 60_000;

// FR-80: the hub's account menu reads the session and signs out; nothing else under /auth.
const HUB_AUTH_PATHS = new Set(['/auth/get-session', '/auth/sign-out']);

// FR-26. One middleware per mount: `/auth/*` for the account center (and the hub on two paths),
// `/v1/*` also for the origins of registered sites, read from oauth_client and kept for a minute
// per isolate.
export function createCors(getDeps: (env: Env) => Promise<Deps>) {
  let siteCache: { origins: string[]; at: number } | undefined;

  async function siteOrigins(deps: Deps) {
    if (siteCache && Date.now() - siteCache.at < SITE_ORIGINS_TTL_MS) return siteCache.origins;
    const result = (await deps.db.execute(
      sql`select redirect_uris from oauth_client where disabled is not true`,
    )) as { rows: { redirect_uris: string[] }[] };
    const origins = originsOf(result.rows.flatMap((r) => r.redirect_uris));
    siteCache = { origins, at: Date.now() };
    return origins;
  }

  const options = (pick: (deps: Deps, c: Context) => Promise<string[]> | string[]) =>
    cors({
      origin: async (origin, c) => {
        const allowed = await pick(await getDeps(c.env as Env), c);
        return isAllowedOrigin(origin, allowed) ? origin : null;
      },
      credentials: true,
      allowHeaders: ['content-type', 'authorization'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }) as MiddlewareHandler<AppEnv>;

  return {
    auth: options((deps, c) =>
      HUB_AUTH_PATHS.has(c.req.path)
        ? [deps.origins.account, deps.origins.hub]
        : [deps.origins.account],
    ),
    api: options(async (deps) => [deps.origins.account, ...(await siteOrigins(deps))]),
  };
}
