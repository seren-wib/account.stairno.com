import { Hono } from 'hono';
import { sql, type SQL } from 'drizzle-orm';
import { createAuth, type Auth } from './auth';
import { createDb } from './db/client';
import { createMailer } from './mail';
import type { Env } from './env';

export interface Deps {
  // Only what the routes need, so tests can pass a PGlite database or a failing stub.
  db: { execute(query: SQL): Promise<unknown> };
  auth: Auth;
}

export function createApp(getDeps: (env: Env) => Promise<Deps>) {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/health', async (c) => {
    try {
      const { db } = await getDeps(c.env);
      await db.execute(sql`select 1`);
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  app.on(['GET', 'POST'], '/auth/*', async (c) => (await getDeps(c.env)).auth.handler(c.req.raw));

  return app;
}

// One set of dependencies per isolate. Better Auth starts an async init when it is created;
// in Workers that promise is tied to the request that created it and is dropped when that
// request ends, so the creating request awaits it before anything else can use the instance.
let deps: Promise<Deps> | undefined;
function workerDeps(env: Env): Promise<Deps> {
  deps ??= (async () => {
    const db = createDb(env.DATABASE_URL);
    const auth = createAuth({
      db,
      apiUrl: env.API_URL,
      accountUrl: env.ACCOUNT_URL,
      cookieDomain: env.COOKIE_DOMAIN,
      secret: env.BETTER_AUTH_SECRET,
      mailer: createMailer({ apiKey: env.RESEND_API_KEY }),
    });
    await auth.$context;
    return { db, auth };
  })().catch((error: unknown) => {
    deps = undefined;
    throw error;
  });
  return deps;
}

export default createApp(workerDeps);
