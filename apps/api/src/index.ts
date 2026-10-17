import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { createAuth } from './auth';
import { createDb } from './db/client';
import { createMailer } from './mail';
import type { AppEnv, Deps } from './deps';
import type { Env } from './env';
import { requireSession } from './middleware/session';
import { meRoutes } from './routes/me';
import { sessionRoutes } from './routes/sessions';

export type { Deps } from './deps';

export function createApp(getDeps: (env: Env) => Promise<Deps>) {
  const app = new Hono<AppEnv>();

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

  app.use('/v1/*', async (c, next) => {
    c.set('deps', await getDeps(c.env));
    await next();
  });
  app.use('/v1/*', requireSession);
  app.route('/v1/me', meRoutes);
  app.route('/v1/sessions', sessionRoutes);

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
