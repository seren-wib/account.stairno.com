import { sql, type SQL } from 'drizzle-orm';
import type { Deps } from '../deps';

// FR-63 to FR-65 (SDD §6.7). A refund request is filed by a site for its buyer and decided by an
// operator; the API keeps it and never judges the policy (FR-66).

type Db = Deps['db'];

export interface RefundRequestRow {
  id: string;
  order_id: string;
  status: string;
  requested_at: string | Date;
  resolved_at: string | Date | null;
}

export interface UserRefundRequestRow extends RefundRequestRow {
  sku: string;
  name_ko: string;
  name_en: string;
  amount: number;
  currency: string;
}

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

export type Filed =
  | { kind: 'filed'; request: RefundRequestRow }
  | { kind: 'not_found' }
  // Only a paid or fulfilled order has anything to refund
  | { kind: 'not_refundable'; status: string }
  | { kind: 'already_open' };

// One statement: the order must be the buyer's, from the calling site, and paid; at most one open
// request per order.
export async function fileRefundRequest(
  db: Db,
  input: { orderId: string; userId: string; clientId: string; reason: string },
): Promise<Filed> {
  const [row] = await rows<
    Partial<RefundRequestRow> & { order_status: string | null; open: boolean }
  >(
    db,
    sql`
      with o as (
        select id, status from "order"
        where id = ${input.orderId} and user_id = ${input.userId} and client_id = ${input.clientId}
      ), open as (
        select 1 from refund_request where order_id = ${input.orderId} and status = 'requested'
      ), made as (
        insert into refund_request (order_id, user_id, reason, status)
        select o.id, ${input.userId}, ${input.reason}, 'requested'
        from o
        where o.status in ('paid', 'fulfilled') and not exists (select 1 from open)
        returning id, order_id, status, requested_at, resolved_at
      )
      select (select status from o) as order_status, exists (select 1 from open) as open,
             made.id, made.order_id, made.status, made.requested_at, made.resolved_at
      from (select 1) one left join made on true`,
  );
  if (!row?.order_status) return { kind: 'not_found' };
  if (row.id) return { kind: 'filed', request: row as RefundRequestRow };
  if (row.open) return { kind: 'already_open' };
  return { kind: 'not_refundable', status: row.order_status };
}

// FR-63: the account center shows the user's requests and where they stand, newest first.
export function listRefundRequests(db: Db, userId: string) {
  return rows<UserRefundRequestRow>(
    db,
    sql`
      select r.id, r.order_id, r.status, r.requested_at, r.resolved_at,
             p.sku, p.name_ko, p.name_en, o.amount, o.currency
      from refund_request r
      join "order" o on o.id = r.order_id
      join product p on p.id = o.product_id
      where r.user_id = ${userId}
      order by r.requested_at desc`,
  );
}
