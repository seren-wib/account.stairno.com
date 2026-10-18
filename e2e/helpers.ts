import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { unstable_startWorker } from 'wrangler';

// e2e/compose.yml: PostgreSQL on 5432 and the Neon HTTP proxy on 4444.
const DIRECT_URL = 'postgres://postgres:postgres@localhost:5432/main';
// The Worker reaches the same database through the proxy, with the production driver.
const WORKER_DATABASE_URL = 'postgres://postgres:postgres@db.localtest.me:5432/main';

const root = new URL('..', import.meta.url);

// Starts from an empty database every run: keys and users left by `npm run dev` were
// encrypted with another BETTER_AUTH_SECRET and would make the Worker fail.
export async function resetDatabase() {
  const client = postgres(DIRECT_URL, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(
      'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
    );
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL('apps/api/src/db/migrations', root)),
    });
  } finally {
    await client.end();
  }
}

const text = (value: string) => ({ type: 'plain_text' as const, value });

// The API Worker on the real Workers runtime (workerd), as `wrangler dev` would run it.
export async function startApiWorker() {
  const worker = await unstable_startWorker({
    config: fileURLToPath(new URL('apps/api/wrangler.toml', root)),
    bindings: {
      API_URL: text('http://localhost:8787'),
      ACCOUNT_URL: text('http://localhost:4321'),
      HUB_URL: text('http://localhost:4322'),
      COOKIE_DOMAIN: text(''),
      DATABASE_URL: text(WORKER_DATABASE_URL),
      BETTER_AUTH_SECRET: text('test-secret-for-e2e-only-0123456789abcdef'),
    },
    dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, watch: false },
  });
  await worker.ready;
  const url = await worker.url;
  return { url, dispose: () => worker.dispose() };
}
