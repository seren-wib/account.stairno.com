import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Deps } from '../deps';
import type { Env } from '../env';
import { isAllowedOrigin, originsOf } from '../lib/origins';

const SITE_ORIGINS_TTL_MS = 60_000;

// The account center: Better Auth's trusted origins, which is exactly ACCOUNT_URL (and the API's own
// origin, which never needs CORS).
async function accountOrigins(deps: Deps) {
  return (await deps.auth.$context).trustedOrigins;
}

// FR-26. One middleware per mount: `/auth/*` for the account center only, `/v1/*` also for the
// origins of registered sites, read from oauth_client and kept for a minute per isolate.
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

  const options = (pick: (deps: Deps) => Promise<string[]>) =>
    cors({
      origin: async (origin, c) => {
        const allowed = await pick(await getDeps(c.env as Env));
        return isAllowedOrigin(origin, allowed) ? origin : null;
      },
      credentials: true,
      allowHeaders: ['content-type', 'authorization'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }) as MiddlewareHandler<AppEnv>;

  return {
    auth: options(accountOrigins),
    api: options(async (deps) => [...(await accountOrigins(deps)), ...(await siteOrigins(deps))]),
  };
}
