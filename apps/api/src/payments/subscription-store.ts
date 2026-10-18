import { sql, type SQL } from 'drizzle-orm';
import type { Deps } from '../deps';
import { allowedFrom } from './orders';
import type { PaymentResult } from './provider';

// FR-46, FR-55 to FR-57 (SDD §6.4). Subscriptions are paid by charging a saved Toss billing key.
// Like the order store, every write is one statement (neon-http has no transactions).

type Db = Deps['db'];

export interface SubscriptionRow {
  id: string;
  status: string;
  current_period_start: string | Date;
  current_period_end: string | Date;
  cancel_at_period_end: boolean;
}

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

const statusIn = (statuses: readonly string[]) =>
  sql.join(
    statuses.map((s) => sql`${s}`),
    sql`, `,
  );

// The card a subscription is charged on: the user's live default, with what Toss needs.
export async function findDefaultCard(db: Db, userId: string) {
  const [row] = await rows<{ id: string; billing_key: string; customer_key: string }>(
    db,
    sql`
      select id, billing_key, customer_key from payment_method
      where user_id = ${userId} and is_default and deleted_at is null`,
  );
  return row;
}

// active and past_due still run; canceled and expired are over.
export async function hasLiveSubscription(db: Db, input: { userId: string; productId: string }) {
  const found = await rows<{ id: string }>(
    db,
    sql`
      select id from subscription
      where user_id = ${input.userId} and product_id = ${input.productId}
        and status in ('active', 'past_due')
      limit 1`,
  );
  return found.length > 0;
}

// FR-46, FR-59: an approved first charge, in one statement. The order is fulfilled out of a
// status the state machine allows, the payment is kept, the subscription runs for one interval
// from now, and the entitlement lasts until the period ends. undefined when another request moved
// the order first, and then nothing else is written.
export async function startSubscription(
  db: Db,
  input: { orderId: string; paymentMethodId: string; provider: string; payment: PaymentResult },
): Promise<SubscriptionRow | undefined> {
  const { payment } = input;
  const [started] = await rows<SubscriptionRow>(
    db,
    sql`
      with moved as (
        update "order" set status = 'fulfilled', paid_at = now(), fulfilled_at = now()
        where id = ${input.orderId} and status in (${statusIn(allowedFrom('confirm'))})
          and user_id is not null
        returning id, user_id, product_id
      ), paid as (
        insert into payment (order_id, provider, provider_payment_key, status, method_summary,
                             receipt_url, raw)
        select id, ${input.provider}, ${payment.providerPaymentKey}, 'done',
               ${payment.methodSummary ?? null}, ${payment.receiptUrl ?? null},
               ${JSON.stringify(payment.raw ?? null)}::jsonb
        from moved
      ), started as (
        insert into subscription (user_id, product_id, payment_method_id, status,
                                  current_period_start, current_period_end, last_attempt_on)
        select m.user_id, m.product_id, ${input.paymentMethodId}, 'active', now(),
               now() + case p.interval when 'year' then interval '1 year'
                                       else interval '1 month' end,
               current_date
        from moved m join product p on p.id = m.product_id
        returning id, user_id, product_id, status, current_period_start, current_period_end,
                  cancel_at_period_end
      ), granted as (
        insert into entitlement (user_id, product_id, status, expires_at, downloadable,
                                 source_order_id, source_subscription_id)
        select s.user_id, s.product_id, 'active', s.current_period_end,
               p.download_key is not null, ${input.orderId}, s.id
        from started s join product p on p.id = s.product_id
        on conflict (user_id, product_id) do update
          set status = 'active', expires_at = excluded.expires_at,
              downloadable = excluded.downloadable, source_order_id = excluded.source_order_id,
              source_subscription_id = excluded.source_subscription_id, updated_at = now()
      )
      select id, status, current_period_start, current_period_end, cancel_at_period_end
      from started`,
  );
  return started;
}
