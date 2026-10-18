import { sql, type SQL } from 'drizzle-orm';
import type { Deps } from '../deps';
import { allowedFrom } from './orders';
import type { PaymentResult } from './provider';

// The order queries. neon-http has no interactive transactions, so every write is one statement,
// guarded by the statuses the state machine allows for its event (SDD §6.2): zero rows means
// another request moved the order first.

type Db = Deps['db'];

export interface OrderRow {
  id: string;
  status: string;
  sku: string;
  currency: string;
  amount: number;
  provider: string;
  created_at: string | Date;
  expires_at: string | Date;
  paid_at: string | Date | null;
  fulfilled_at: string | Date | null;
  refunded_at: string | Date | null;
  // Only from readOrder: where the provider sends the payer back, and its own order id
  return_url?: string;
  provider_order_id?: string | null;
}

export interface OrderTarget {
  email_verified: boolean;
  locale: string;
  product_id: string | null;
  kind: string | null;
  name_ko: string | null;
  name_en: string | null;
  // null when the product has no price in the currency
  amount: number | null;
}

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

const statusIn = (statuses: readonly string[]) =>
  sql.join(
    statuses.map((s) => sql`${s}`),
    sql`, `,
  );

// The buyer and, when the calling site sells it and it is active, the product and its price in
// the currency, in one round trip (NFR-2). undefined when the buyer does not exist.
export async function findOrderTarget(
  db: Db,
  input: { userId: string; clientId: string; sku: string; currency: string },
): Promise<OrderTarget | undefined> {
  const [found] = await rows<OrderTarget>(
    db,
    sql`
      select u.email_verified, u.locale, p.id as product_id, p.kind, p.name_ko, p.name_en,
             pp.amount
      from "user" u
      left join product p
        on p.sku = ${input.sku} and p.client_id = ${input.clientId} and p.active
      left join product_price pp on pp.product_id = p.id and pp.currency = ${input.currency}
      where u.id = ${input.userId}`,
  );
  return found;
}

// FR-35, FR-36: a pending order, open for 30 minutes by the database clock that also expires it.
export async function insertOrder(
  db: Db,
  input: {
    userId: string;
    clientId: string;
    productId: string;
    sku: string;
    currency: string;
    amount: number;
    provider: string;
    returnUrl: string;
  },
): Promise<OrderRow> {
  const [order] = await rows<OrderRow>(
    db,
    sql`
      insert into "order" (user_id, client_id, product_id, currency, amount, status, provider,
                           return_url, expires_at)
      values (${input.userId}, ${input.clientId}, ${input.productId}, ${input.currency},
              ${input.amount}, 'pending', ${input.provider}, ${input.returnUrl},
              now() + interval '30 minutes')
      returning id, status, ${input.sku}::text as sku, currency, amount, provider, created_at,
                expires_at, paid_at, fulfilled_at, refunded_at`,
  );
  if (!order) throw new Error('the order was not created');
  return order;
}

export interface PaymentRow {
  order_id: string;
  provider: string;
  provider_payment_key: string;
  status: 'pending' | 'done' | 'failed' | 'canceled';
  method_summary: string | null;
  receipt_url: string | null;
  failure_reason: string | null;
}

// FR-38: the payment recorded under a provider payment key, whichever order it belongs to.
export async function findPayment(db: Db, providerPaymentKey: string) {
  const [payment] = await rows<PaymentRow>(
    db,
    sql`
      select order_id, provider, provider_payment_key, status, method_summary, receipt_url,
             failure_reason
      from payment where provider_payment_key = ${providerPaymentKey}`,
  );
  return payment;
}

// FR-38 for providers whose payment key is only known after the call (the PayPal capture id).
export async function findPaymentForOrder(db: Db, orderId: string) {
  const [payment] = await rows<PaymentRow>(
    db,
    sql`
      select order_id, provider, provider_payment_key, status, method_summary, receipt_url,
             failure_reason
      from payment where order_id = ${orderId}
      order by created_at limit 1`,
  );
  return payment;
}

// FR-49: the provider's order for one of ours, kept while the order can still be paid.
export async function setProviderOrderId(
  db: Db,
  input: { orderId: string; providerOrderId: string },
): Promise<boolean> {
  const moved = await rows<{ id: string }>(
    db,
    sql`
      update "order" set provider_order_id = ${input.providerOrderId}
      where id = ${input.orderId} and status in (${statusIn(allowedFrom('confirm'))})
      returning id`,
  );
  return moved.length > 0;
}

// FR-44: a pending order whose confirm came with the wrong amount fails before the provider is
// asked. false when another request moved it first.
export async function failPendingOrder(db: Db, orderId: string): Promise<boolean> {
  const moved = await rows<{ id: string }>(
    db,
    sql`
      update "order" set status = 'failed'
      where id = ${orderId} and status in (${statusIn(allowedFrom('fail'))})
      returning id`,
  );
  return moved.length > 0;
}

// FR-37, FR-39, FR-43: what the provider answered, written in one statement. The order moves
// only out of a status the state machine allows; the payment and, for a fulfilled order, the
// entitlement are written only when it did. `fulfilled` is confirm and grant together, so paid_at
// and fulfilled_at are stamped at once. false when another request moved the order first.
export async function settleOrder(
  db: Db,
  input: {
    orderId: string;
    to: 'fulfilled' | 'failed';
    provider: string;
    payment: PaymentResult;
  },
): Promise<boolean> {
  const { payment } = input;
  const fulfilled = input.to === 'fulfilled';
  const from = fulfilled ? allowedFrom('confirm') : allowedFrom('fail');
  const [result] = await rows<{ moved: number }>(
    db,
    sql`
      with moved as (
        update "order" set status = ${input.to},
          paid_at = case when ${fulfilled} then now() else paid_at end,
          fulfilled_at = case when ${fulfilled} then now() else fulfilled_at end
        where id = ${input.orderId} and status in (${statusIn(from)})
        returning id, user_id, product_id
      ), paid as (
        insert into payment (order_id, provider, provider_payment_key, status, method_summary,
                             receipt_url, failure_reason, raw)
        select id, ${input.provider}, ${payment.providerPaymentKey}, ${payment.status},
               ${payment.methodSummary ?? null}, ${payment.receiptUrl ?? null},
               ${payment.failureReason ?? null}, ${JSON.stringify(payment.raw ?? null)}::jsonb
        from moved
        on conflict (provider_payment_key) do nothing
      ), granted as (
        insert into entitlement (user_id, product_id, status, downloadable, source_order_id)
        select m.user_id, m.product_id, 'active', p.download_key is not null, m.id
        from moved m join product p on p.id = m.product_id
        where ${fulfilled} and m.user_id is not null
        on conflict (user_id, product_id) do update
          set status = 'active', expires_at = null, downloadable = excluded.downloadable,
              source_order_id = excluded.source_order_id, updated_at = now()
      )
      select count(*)::int as moved from moved`,
  );
  return (result?.moved ?? 0) > 0;
}

// FR-36, FR-40: an order, expired first if it is pending past its 30 minutes. The update and the
// read are one statement, so the answer is the order as it now is. With `clientId` only that
// site's order is found; without it (a provider's webhook) any order is.
export async function readOrder(
  db: Db,
  input: { id: string; clientId?: string },
): Promise<OrderRow | undefined> {
  const anySite = input.clientId === undefined;
  const ofSite = anySite ? sql`true` : sql`client_id = ${input.clientId}`;
  const orderOfSite = anySite ? sql`true` : sql`o.client_id = ${input.clientId}`;
  const [order] = await rows<OrderRow>(
    db,
    sql`
      with expired as (
        update "order" set status = 'expired'
        where id = ${input.id} and ${ofSite}
          and status in (${statusIn(allowedFrom('expire'))}) and expires_at <= now()
        returning id
      )
      select o.id, case when e.id is null then o.status else 'expired' end as status,
             p.sku, o.currency, o.amount, o.provider, o.created_at, o.expires_at, o.paid_at,
             o.fulfilled_at, o.refunded_at, o.return_url, o.provider_order_id
      from "order" o
      join product p on p.id = o.product_id
      left join expired e on e.id = o.id
      where o.id = ${input.id} and ${orderOfSite}`,
  );
  return order;
}

export const readSiteOrder = (db: Db, input: { id: string; clientId: string }) =>
  readOrder(db, input);

// FR-48, FR-61: the provider says the payment was canceled (a refund made at its dashboard, or
// our own cancel). A paid or fulfilled order becomes refunded and its entitlement is revoked; the
// payment row turns canceled whatever the order's state. false when the order did not move.
export async function refundOrder(
  db: Db,
  input: { orderId: string; providerPaymentKey: string; raw: unknown },
): Promise<boolean> {
  const [result] = await rows<{ moved: number }>(
    db,
    sql`
      with moved as (
        update "order" set status = 'refunded', refunded_at = now()
        where id = ${input.orderId} and status in (${statusIn(allowedFrom('refund'))})
        returning id
      ), canceled as (
        update payment set status = 'canceled', raw = ${JSON.stringify(input.raw ?? null)}::jsonb,
                           updated_at = now()
        where provider_payment_key = ${input.providerPaymentKey} and order_id = ${input.orderId}
          and status <> 'canceled'
      ), revoked as (
        update entitlement set status = 'revoked', updated_at = now()
        where source_order_id in (select id from moved)
      )
      select count(*)::int as moved from moved`,
  );
  return (result?.moved ?? 0) > 0;
}
