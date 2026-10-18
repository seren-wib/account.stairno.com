import { sql, type SQL } from 'drizzle-orm';
import type { Deps } from '../deps';

// FR-32, FR-63: the user's orders across every site, as the account center shows them. Pending
// and expired orders are checkouts nobody finished, so they are left out. Each order carries its
// latest payment and its latest refund request.

type Db = Deps['db'];

export interface HistoryRow {
  id: string;
  sku: string;
  name_ko: string;
  name_en: string;
  kind: string;
  status: string;
  amount: number;
  currency: string;
  provider: string;
  created_at: string | Date;
  paid_at: string | Date | null;
  refunded_at: string | Date | null;
  payment_status: string | null;
  method_summary: string | null;
  receipt_url: string | null;
  refund_status: string | null;
  refund_requested_at: string | Date | null;
  refund_resolved_at: string | Date | null;
  // created_at to the microsecond, for the page cursor (a JS Date keeps only milliseconds)
  cursor_at: string;
}

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

function history(db: Db, userId: string, where: SQL, limit: number) {
  return rows<HistoryRow>(
    db,
    sql`
      select o.id, p.sku, p.name_ko, p.name_en, p.kind, o.status, o.amount, o.currency,
             o.provider, o.created_at, o.paid_at, o.refunded_at,
             pay.status as payment_status, pay.method_summary, pay.receipt_url,
             rr.status as refund_status, rr.requested_at as refund_requested_at,
             rr.resolved_at as refund_resolved_at,
             to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
      from "order" o
      join product p on p.id = o.product_id
      left join lateral (
        select status, method_summary, receipt_url from payment
        where order_id = o.id order by created_at desc limit 1
      ) pay on true
      left join lateral (
        select status, requested_at, resolved_at from refund_request
        where order_id = o.id order by requested_at desc limit 1
      ) rr on true
      where o.user_id = ${userId} and o.status not in ('pending', 'expired') and ${where}
      order by o.created_at desc, o.id desc
      limit ${limit}`,
  );
}

// Newest first. `before` is the last row of the previous page; one extra row says whether there
// is a next page.
export async function listUserOrders(
  db: Db,
  input: { userId: string; limit: number; before?: { at: string; id: string } },
) {
  const after = input.before
    ? sql`(o.created_at, o.id) < (${input.before.at}::timestamptz, ${input.before.id}::uuid)`
    : sql`true`;
  const found = await history(db, input.userId, after, input.limit + 1);
  return { items: found.slice(0, input.limit), more: found.length > input.limit };
}

export async function readUserOrder(db: Db, input: { userId: string; id: string }) {
  const [row] = await history(db, input.userId, sql`o.id = ${input.id}`, 1);
  return row;
}
