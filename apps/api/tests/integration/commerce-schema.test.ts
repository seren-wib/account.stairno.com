import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { createTestApp } from '../helpers/app';
import { PASSWORD, post, signUp } from '../helpers/auth';
import { registerLabs } from '../helpers/oidc';

// The constraints the payment work relies on (SDD §5), proven on the migrated database.
// Only the schema is under test here: no routes, no adapter, no state machine.

type Db = Awaited<ReturnType<typeof createTestApp>>['db'];

// The PostgreSQL message behind a failed Drizzle query, which Drizzle wraps as its cause.
async function failure(query: Promise<unknown>) {
  try {
    await query;
  } catch (error) {
    return (error as { cause?: Error }).cause?.message ?? (error as Error).message;
  }
  throw new Error('expected the query to fail');
}

async function userId(db: Db, email: string) {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));
  return row!.id;
}

async function seed() {
  const ctx = await createTestApp();
  const { db } = ctx;
  const site = await registerLabs(ctx);
  const buyer = await signUp(ctx.app);
  const buyerId = await userId(db, buyer.email);
  const [product] = await db
    .insert(schema.product)
    .values({
      sku: 'atlas-odyssey-desktop',
      clientId: site.clientId,
      nameKo: '아틀라스 오디세이 데스크톱',
      nameEn: 'Atlas Odyssey Desktop',
      kind: 'one_time',
      downloadKey: 'atlas-odyssey/1.0.0/setup.exe',
    })
    .returning();
  return { ...ctx, site, buyer, buyerId, product: product! };
}

function order(input: {
  userId: string | null;
  clientId: string;
  productId: string;
  currency?: string;
  amount?: number;
  provider?: string;
}): typeof schema.order.$inferInsert {
  return {
    currency: 'KRW',
    amount: 12000,
    provider: 'toss',
    status: 'pending',
    returnUrl: 'https://stairnolabs.com/checkout/done',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    ...input,
  };
}

describe('commerce schema', () => {
  it('FR-34 a sku is registered once', async () => {
    const { db, site } = await seed();

    expect(
      await failure(
        db.insert(schema.product).values({
          sku: 'atlas-odyssey-desktop',
          clientId: site.clientId,
          nameKo: '중복',
          nameEn: 'Duplicate',
          kind: 'one_time',
        }),
      ),
    ).toMatch(/unique/);
  });

  it('FR-34 DR-9 a product has one integer amount per currency', async () => {
    const { db, product } = await seed();

    await db
      .insert(schema.productPrice)
      .values({ productId: product.id, currency: 'KRW', amount: 12000 });
    await db
      .insert(schema.productPrice)
      .values({ productId: product.id, currency: 'USD', amount: 900 });

    expect(
      await failure(
        db
          .insert(schema.productPrice)
          .values({ productId: product.id, currency: 'KRW', amount: 13000 }),
      ),
    ).toMatch(/unique/);
    expect(
      await failure(
        db
          .insert(schema.productPrice)
          .values({ productId: product.id, currency: 'EUR', amount: 8.5 }),
      ),
    ).toMatch(/integer/);
  });

  it('FR-40 an order belongs to a registered site and an existing product', async () => {
    const { db, buyerId, product } = await seed();

    expect(
      await failure(
        db
          .insert(schema.order)
          .values(order({ userId: buyerId, clientId: 'not-a-site', productId: product.id })),
      ),
    ).toMatch(/foreign key/);
  });

  it('FR-38 a provider payment key is recorded once', async () => {
    const { db, buyerId, site, product } = await seed();
    const [row] = await db
      .insert(schema.order)
      .values(order({ userId: buyerId, clientId: site.clientId, productId: product.id }))
      .returning();
    const payment = {
      orderId: row!.id,
      provider: 'toss',
      providerPaymentKey: 'tgen_20261018_001',
      status: 'done',
    };

    await db.insert(schema.payment).values(payment);

    expect(await failure(db.insert(schema.payment).values(payment))).toMatch(/unique/);
  });

  it('FR-68 a webhook event is stored once per provider', async () => {
    const { db } = await seed();
    const event = {
      provider: 'paypal',
      eventId: 'WH-1',
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      payload: {},
      status: 'received',
    };

    await db.insert(schema.webhookEvent).values(event);
    await db.insert(schema.webhookEvent).values({ ...event, provider: 'toss' });

    expect(await failure(db.insert(schema.webhookEvent).values(event))).toMatch(/unique/);
  });

  it('FR-59 a user holds one entitlement per product', async () => {
    const { db, buyerId, product } = await seed();
    const entitlement = {
      userId: buyerId,
      productId: product.id,
      status: 'active',
      downloadable: true,
    };

    await db.insert(schema.entitlement).values(entitlement);

    expect(await failure(db.insert(schema.entitlement).values(entitlement))).toMatch(/unique/);
  });

  it('FR-53 a user has at most one live default payment method', async () => {
    const { db, buyerId } = await seed();
    const method = {
      userId: buyerId,
      provider: 'toss',
      billingKey: 'enc:...',
      customerKey: crypto.randomUUID(),
      cardCompany: '신한',
      cardLast4: '1234',
      isDefault: true,
    };

    await db.insert(schema.paymentMethod).values({ ...method, deletedAt: new Date() });
    await db.insert(schema.paymentMethod).values(method);

    expect(await failure(db.insert(schema.paymentMethod).values(method))).toMatch(/unique/);
    await expect(
      db.insert(schema.paymentMethod).values({ ...method, isDefault: false }),
    ).resolves.toBeDefined();
  });

  it('FR-8 deleting the account keeps the order and refund request without the user and drops the rest', async () => {
    const { app, db, buyer, buyerId, site, product } = await seed();
    const [row] = await db
      .insert(schema.order)
      .values(order({ userId: buyerId, clientId: site.clientId, productId: product.id }))
      .returning();
    await db.insert(schema.refundRequest).values({
      orderId: row!.id,
      userId: buyerId,
      reason: 'changed my mind',
      status: 'requested',
    });
    const [method] = await db
      .insert(schema.paymentMethod)
      .values({
        userId: buyerId,
        provider: 'toss',
        billingKey: 'enc:...',
        customerKey: crypto.randomUUID(),
        isDefault: true,
      })
      .returning();
    await db.insert(schema.subscription).values({
      userId: buyerId,
      productId: product.id,
      paymentMethodId: method!.id,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await db
      .insert(schema.entitlement)
      .values({ userId: buyerId, productId: product.id, status: 'active' });

    const res = await post(app, '/auth/delete-user', { password: PASSWORD }, buyer.cookie);

    expect(res.status).toBe(200);
    const orders = await db.select().from(schema.order);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.userId).toBeNull();
    const refunds = await db.select().from(schema.refundRequest);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.userId).toBeNull();
    for (const table of ['payment_method', 'subscription', 'entitlement'] as const) {
      const { rows } = await db.execute(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      expect(rows[0]?.n, table).toBe(0);
    }
  });

  it('FR-34 a product with orders cannot be removed', async () => {
    const { db, buyerId, site, product } = await seed();
    await db
      .insert(schema.order)
      .values(order({ userId: buyerId, clientId: site.clientId, productId: product.id }));

    expect(
      await failure(db.delete(schema.product).where(eq(schema.product.id, product.id))),
    ).toMatch(/foreign key/);
  });
});
