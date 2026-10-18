import { sql, type SQL } from 'drizzle-orm';
import type { Deps } from '../deps';
import { allowedFrom } from './orders';

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

// FR-36, FR-40: the site's own order, expired first if it is pending past its 30 minutes. The
// update and the read are one statement, so the answer is the order as it now is.
export async function readSiteOrder(
  db: Db,
  input: { id: string; clientId: string },
): Promise<OrderRow | undefined> {
  const [order] = await rows<OrderRow>(
    db,
    sql`
      with expired as (
        update "order" set status = 'expired'
        where id = ${input.id} and client_id = ${input.clientId}
          and status in (${statusIn(allowedFrom('expire'))}) and expires_at <= now()
        returning id
      )
      select o.id, case when e.id is null then o.status else 'expired' end as status,
             p.sku, o.currency, o.amount, o.provider, o.created_at, o.expires_at, o.paid_at,
             o.fulfilled_at, o.refunded_at
      from "order" o
      join product p on p.id = o.product_id
      left join expired e on e.id = o.id
      where o.id = ${input.id} and o.client_id = ${input.clientId}`,
  );
  return order;
}
