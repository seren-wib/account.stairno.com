import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { refund, rejectRefund } from '../../src/admin/refund';
import { createFakeProvider } from '../../src/payments/fake';
import { ProviderError } from '../../src/payments/provider';
import { createTestApp } from '../helpers/app';
import { registerLabs } from '../helpers/oidc';
import { signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

// FR-64, FR-66 (SDD §6.7): an operator decides a refund with a command. Refunding cancels the
// payment at its provider, then the order is refunded, its entitlement revoked, a subscription
// it paid for ended, and the open request resolved. Rejecting only resolves the request.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

async function all<T>(db: Ctx['db'], query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

async function setup(kind: 'one_time' | 'subscription' = 'one_time') {
  stubPwnedPasswords();
  const toss = createFakeProvider();
  const ctx = await createTestApp({ providers: { toss } });
  const site = await registerLabs(ctx);
  await addProduct(ctx.db, {
    sku: 'atlas',
    clientId: site.clientId,
    nameKo: '아틀라스',
    nameEn: 'Atlas',
    kind,
    ...(kind === 'subscription' ? { interval: 'month' } : {}),
    prices: [{ currency: 'KRW', amount: 12000 }],
  });
  const buyer = await signUp(ctx.app);
  const [user] = await all<{ id: string }>(
    ctx.db,
    sql`select id from "user" where email = ${buyer.email}`,
  );
  // A paid order as the payment flow leaves it: fulfilled, its payment done at the provider,
  // its entitlement active, and for a subscription the subscription it started.
  const [order] = await all<{ id: string }>(
    ctx.db,
    sql`insert into "order" (user_id, client_id, product_id, currency, amount, status, provider,
                             return_url, expires_at, paid_at, fulfilled_at)
        select ${user!.id}, ${site.clientId}, p.id, 'KRW', 12000, 'fulfilled', 'toss',
               'https://stairnolabs.com/done', now(), now(), now()
        from product p returning id`,
  );
  await toss.confirm({
    order: { id: order!.id, amount: 12000, currency: 'KRW' },
    providerPaymentKey: 'pay_1',
    amount: 12000,
    currency: 'KRW',
  });
  await ctx.db.execute(sql`
    insert into payment (order_id, provider, provider_payment_key, status)
    values (${order!.id}, 'toss', 'pay_1', 'done')`);
  const [sub] =
    kind === 'subscription'
      ? await all<{ id: string }>(
          ctx.db,
          sql`insert into subscription (user_id, product_id, status, current_period_start,
                                        current_period_end)
              select ${user!.id}, p.id, 'active', now(), now() + interval '1 month' from product p
              returning id`,
        )
      : [undefined];
  await ctx.db.execute(sql`
    insert into entitlement (user_id, product_id, status, expires_at, source_order_id,
                             source_subscription_id)
    select ${user!.id}, p.id, 'active',
           case when ${kind} = 'subscription' then now() + interval '1 month' end,
           ${order!.id}, ${sub?.id ?? null}
    from product p`);
  await ctx.db.execute(sql`
    insert into refund_request (order_id, user_id, reason, status)
    values (${order!.id}, ${user!.id}, 'It does not start.', 'requested')`);
  return { ...ctx, toss, orderId: order!.id, subscriptionId: sub?.id };
}

const cancels = (toss: ReturnType<typeof createFakeProvider>) =>
  toss.calls.filter((call) => call.method === 'cancel');

describe('admin refund', () => {
  it('FR-64 FR-61 cancels at the provider, refunds the order, revokes, resolves the request', async () => {
    const ctx = await setup();

    expect(await refund(ctx.deps, { orderId: ctx.orderId, reason: 'Does not start.' })).toEqual({
      kind: 'refunded',
    });

    expect(cancels(ctx.toss)).toEqual([
      { method: 'cancel', input: { providerPaymentKey: 'pay_1', reason: 'Does not start.' } },
    ]);
    expect(await all(ctx.db, sql`select status from "order"`)).toEqual([{ status: 'refunded' }]);
    expect(await all(ctx.db, sql`select status from payment`)).toEqual([{ status: 'canceled' }]);
    expect(await all(ctx.db, sql`select status from entitlement`)).toEqual([{ status: 'revoked' }]);
    expect(
      await all(
        ctx.db,
        sql`select status, resolved_at is not null as resolved from refund_request`,
      ),
    ).toEqual([{ status: 'refunded', resolved: true }]);
  });

  it('FR-64 ends the subscription the refunded order paid for', async () => {
    const ctx = await setup('subscription');

    await refund(ctx.deps, { orderId: ctx.orderId, reason: 'Changed my mind.' });

    expect(await all(ctx.db, sql`select status from subscription`)).toEqual([
      { status: 'canceled' },
    ]);
  });

  it('FR-64 does nothing to an order that has nothing to refund', async () => {
    const ctx = await setup();
    await ctx.db.execute(sql`update "order" set status = 'refunded'`);

    expect(await refund(ctx.deps, { orderId: ctx.orderId, reason: 'Again.' })).toEqual({
      kind: 'not_refundable',
      status: 'refunded',
    });
    expect(cancels(ctx.toss)).toEqual([]);
  });

  it('FR-64 changes nothing when the provider cannot cancel', async () => {
    const ctx = await setup();
    ctx.toss.willThrow();

    await expect(
      refund(ctx.deps, { orderId: ctx.orderId, reason: 'Please.' }),
    ).rejects.toBeInstanceOf(ProviderError);

    expect(await all(ctx.db, sql`select status from "order"`)).toEqual([{ status: 'fulfilled' }]);
    expect(await all(ctx.db, sql`select status from refund_request`)).toEqual([
      { status: 'requested' },
    ]);
  });

  it('FR-64 answers not_found for an unknown order', async () => {
    const ctx = await setup();

    expect(
      await refund(ctx.deps, { orderId: '00000000-0000-4000-8000-000000000000', reason: 'x' }),
    ).toEqual({ kind: 'not_found' });
  });

  it('FR-66 rejects a request without touching the payment', async () => {
    const ctx = await setup();

    expect(await rejectRefund(ctx.deps, { orderId: ctx.orderId })).toEqual({ kind: 'rejected' });

    expect(cancels(ctx.toss)).toEqual([]);
    expect(await all(ctx.db, sql`select status from "order"`)).toEqual([{ status: 'fulfilled' }]);
    expect(
      await all(
        ctx.db,
        sql`select status, resolved_at is not null as resolved from refund_request`,
      ),
    ).toEqual([{ status: 'rejected', resolved: true }]);
    expect(await rejectRefund(ctx.deps, { orderId: ctx.orderId })).toEqual({ kind: 'no_request' });
  });
});
