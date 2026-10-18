import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { createAuth } from './auth';
import { createDb } from './db/client';
import { createMailer } from './mail';
import type { AppEnv, Deps } from './deps';
import type { Env } from './env';
import { apiError } from './http/errors';
import { createCors } from './middleware/cors';
import { authenticate } from './middleware/session';
import { connectionRoutes } from './routes/connections';
import { downloadFileRoutes, downloadRoutes } from './routes/downloads';
import { entitlementRoutes } from './routes/entitlements';
import { removeBillingKeysOf } from './payments/account-deletion';
import { parsePaymentsMode } from './payments/mode';
import { createPayPalProvider } from './payments/paypal';
import { createTossProvider } from './payments/toss';
import { meRoutes } from './routes/me';
import { orderRoutes } from './routes/orders';
import { paymentMethodRoutes } from './routes/payment-methods';
import { paymentRoutes } from './routes/payments';
import { productRoutes } from './routes/products';
import { sessionRoutes } from './routes/sessions';
import { subscriptionRoutes } from './routes/subscriptions';
import { renewDueSubscriptions } from './subscriptions/renew';
import { webhookRoutes } from './routes/webhooks';

export type { Deps } from './deps';

export function createApp(getDeps: (env: Env) => Promise<Deps>) {
  const app = new Hono<AppEnv>();

  // NFR-7 (SDD §9). CORP stays off: sites and the account center read this API across origins.
  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      referrerPolicy: 'strict-origin-when-cross-origin',
      crossOriginResourcePolicy: false,
    }),
  );

  // FR-26: before everything else, so preflights are answered without a session.
  const corsFor = createCors(getDeps);
  app.use('/auth/*', corsFor.auth);
  app.use('/v1/*', corsFor.api);

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

  const withDeps = createMiddleware<AppEnv>(async (c, next) => {
    c.set('deps', await getDeps(c.env));
    await next();
  });

  // FR-67: payment providers call these without a session; each adapter verifies its own (FR-70).
  app.use('/webhooks/*', withDeps);
  app.route('/webhooks', webhookRoutes);

  // FR-62: a signed download link carries its own permission; no session.
  app.use('/downloads/*', withDeps);
  app.route('/downloads', downloadFileRoutes);

  app.use('/v1/*', withDeps);
  // Every /v1 route has a caller first (SDD §8); each group then says which kind it takes.
  app.use('/v1/*', authenticate);
  app.route('/v1/connections', connectionRoutes);
  app.route('/v1/downloads', downloadRoutes);
  app.route('/v1/entitlements', entitlementRoutes);
  app.route('/v1/me', meRoutes);
  app.route('/v1/orders', orderRoutes);
  app.route('/v1/payment-methods', paymentMethodRoutes);
  app.route('/v1/payments', paymentRoutes);
  app.route('/v1/products', productRoutes);
  app.route('/v1/sessions', sessionRoutes);
  app.route('/v1/subscriptions', subscriptionRoutes);

  app.notFound((c) => apiError(c, 404, 'not_found', 'Nothing here.'));

  // FR-24: anything unexpected is a 500 in the same format. The log has the path and the error,
  // never the request headers or body (NFR-21).
  app.onError((error, c) => {
    console.error('unhandled error', {
      path: c.req.path,
      name: error.name,
      message: error.message,
    });
    return apiError(c, 500, 'internal_error', 'Something went wrong. Please try again.');
  });

  return app;
}

// One set of dependencies per isolate. Better Auth starts an async init when it is created;
// in Workers that promise is tied to the request that created it and is dropped when that
// request ends, so the creating request awaits it before anything else can use the instance.
let deps: Promise<Deps> | undefined;
function workerDeps(env: Env): Promise<Deps> {
  deps ??= (async () => {
    const db = createDb(env.DATABASE_URL);
    const paymentsMode = parsePaymentsMode(env.PAYMENTS_MODE);
    const payments = {
      db,
      billingKeySecret: env.BILLING_KEY_SECRET,
      providers: {
        toss: createTossProvider({ secretKey: env.TOSS_SECRET_KEY, mode: paymentsMode }),
        paypal: createPayPalProvider({
          clientId: env.PAYPAL_CLIENT_ID,
          clientSecret: env.PAYPAL_CLIENT_SECRET,
          webhookId: env.PAYPAL_WEBHOOK_ID,
          mode: paymentsMode,
        }),
      },
    };
    const auth = createAuth({
      db,
      apiUrl: env.API_URL,
      accountUrl: env.ACCOUNT_URL,
      hubUrl: env.HUB_URL,
      cookieDomain: env.COOKIE_DOMAIN,
      secret: env.BETTER_AUTH_SECRET,
      mailer: createMailer({ apiKey: env.RESEND_API_KEY }),
      beforeDeleteUser: (userId) => removeBillingKeysOf(payments, userId),
    });
    await auth.$context;
    return {
      ...payments,
      auth,
      origins: { account: env.ACCOUNT_URL, hub: env.HUB_URL },
      paymentsMode,
      tossClientKey: env.TOSS_CLIENT_KEY,
      downloads: env.DOWNLOADS,
      // Download links are signed under a key derived from this, never with it directly.
      downloadSecret: env.BETTER_AUTH_SECRET,
    };
  })().catch((error: unknown) => {
    deps = undefined;
    throw error;
  });
  return deps;
}

const app = createApp(workerDeps);

export default {
  fetch: app.fetch,
  // FR-57: the daily renewal run (wrangler.toml [triggers]). Typed by hand so the tests, which
  // compile with Node's types, can import this module too.
  async scheduled(
    _controller: unknown,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    ctx.waitUntil(workerDeps(env).then((ready) => renewDueSubscriptions(ready)));
  },
};
