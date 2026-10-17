import { Hono } from 'hono';
import { sql, type SQL } from 'drizzle-orm';
import { createDb } from './db/client';
import type { Env } from './env';

export interface Deps {
  // Only what the routes need, so tests can pass a PGlite database or a failing stub.
  db: { execute(query: SQL): Promise<unknown> };
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

  return app;
}

// One set of dependencies per isolate. Env does not change between requests of one deployment.
let deps: Promise<Deps> | undefined;
function workerDeps(env: Env): Promise<Deps> {
  deps ??= Promise.resolve({ db: createDb(env.DATABASE_URL) });
  return deps;
}

export default createApp(workerDeps);
