import { sql, type SQL } from 'drizzle-orm';
import type { Deps } from '../deps';

// FR-45, FR-53, FR-54: a user's cards. Only live rows (no deleted_at) count; removed rows stay so
// their customer_key is kept. At most one live default per user, held by a partial unique index.

type Db = Deps['db'];

export interface PaymentMethodRow {
  id: string;
  provider: string;
  card_company: string | null;
  card_last4: string | null;
  is_default: boolean;
  created_at: string | Date;
}

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

const LIVE_COLUMNS = sql`id, provider, card_company, card_last4, is_default, created_at`;

export function listPaymentMethods(db: Db, userId: string) {
  return rows<PaymentMethodRow>(
    db,
    sql`
      select ${LIVE_COLUMNS} from payment_method
      where user_id = ${userId} and deleted_at is null
      order by is_default desc, created_at`,
  );
}

// The customerKey a user's cards already use, removed ones included (SDD §6.4).
export async function storedCustomerKey(db: Db, userId: string): Promise<string | undefined> {
  const [row] = await rows<{ customer_key: string }>(
    db,
    sql`
      select customer_key from payment_method where user_id = ${userId}
      order by created_at limit 1`,
  );
  return row?.customer_key;
}

export async function findPaymentMethod(db: Db, input: { userId: string; id: string }) {
  const [row] = await rows<PaymentMethodRow & { billing_key: string }>(
    db,
    sql`
      select ${LIVE_COLUMNS}, billing_key from payment_method
      where id = ${input.id} and user_id = ${input.userId} and deleted_at is null`,
  );
  return row;
}

const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: string }; code?: string }).cause?.code === '23505' ||
  (error as { code?: string }).code === '23505';

// The first live card becomes the default (FR-53). Two first cards at once would both try, and
// the unique index lets one win; the other is added as an ordinary card.
export async function addPaymentMethod(
  db: Db,
  input: {
    userId: string;
    provider: string;
    billingKey: string;
    customerKey: string;
    cardCompany?: string;
    cardLast4?: string;
  },
): Promise<PaymentMethodRow> {
  const insert = (asDefault: SQL) =>
    rows<PaymentMethodRow>(
      db,
      sql`
        insert into payment_method (user_id, provider, billing_key, customer_key, card_company,
                                    card_last4, is_default)
        select ${input.userId}, ${input.provider}, ${input.billingKey}, ${input.customerKey},
               ${input.cardCompany ?? null}, ${input.cardLast4 ?? null}, ${asDefault}
        returning ${LIVE_COLUMNS}`,
    );
  const noDefaultYet = sql`not exists (
    select 1 from payment_method
    where user_id = ${input.userId} and is_default and deleted_at is null)`;
  try {
    return (await insert(noDefaultYet))[0]!;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return (await insert(sql`false`))[0]!;
  }
}

// FR-54: a card an active or overdue subscription is charged to.
export async function paysASubscription(db: Db, paymentMethodId: string): Promise<boolean> {
  const [row] = await rows<{ used: boolean }>(
    db,
    sql`
      select exists (
        select 1 from subscription
        where payment_method_id = ${paymentMethodId} and status in ('active', 'past_due')
      ) as used`,
  );
  return row?.used ?? false;
}

// FR-53: removed (kept for its customer_key), and the newest other card takes over as default.
// Two statements: a unique index is checked row by row, so one statement that unsets one default
// and sets another could trip on its own order.
export async function removePaymentMethod(db: Db, input: { userId: string; id: string }) {
  const [removed] = await rows<{ was_default: boolean }>(
    db,
    sql`
      update payment_method set deleted_at = now(), is_default = false
      where id = ${input.id} and user_id = ${input.userId} and deleted_at is null
      returning (select pm.is_default from payment_method pm where pm.id = ${input.id}) as was_default`,
  );
  if (!removed?.was_default) return;
  await db.execute(sql`
    update payment_method set is_default = true
    where id = (
      select id from payment_method
      where user_id = ${input.userId} and deleted_at is null
      order by created_at desc limit 1)
      and not exists (
        select 1 from payment_method
        where user_id = ${input.userId} and is_default and deleted_at is null)`);
}

// FR-53: this card becomes the one default. Unset first, then set, for the same reason as above.
// FR-54: live subscriptions follow it, so they are always charged on the default and the card
// they leave can be removed.
export async function makeDefaultPaymentMethod(db: Db, input: { userId: string; id: string }) {
  await db.execute(sql`
    update payment_method set is_default = false
    where user_id = ${input.userId} and is_default and deleted_at is null and id <> ${input.id}`);
  await db.execute(sql`
    with made as (
      update payment_method set is_default = true
      where id = ${input.id} and user_id = ${input.userId} and deleted_at is null
      returning id
    )
    update subscription set payment_method_id = made.id
    from made
    where subscription.user_id = ${input.userId} and subscription.status in ('active', 'past_due')`);
}
