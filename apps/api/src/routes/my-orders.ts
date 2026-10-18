import { Hono } from 'hono';
import { pageQuerySchema } from '@stairno-account/contract';
import type { AppEnv } from '../deps';
import { apiError, invalidField, validationError } from '../http/errors';
import { requireCookieSession, requireUser } from '../middleware/session';
import { listUserOrders, readUserOrder, type HistoryRow } from '../payments/order-history';

// FR-32, FR-63: the account center's order history. Only its own session reads it: a token the
// user gave one site must not show what they bought on the others.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (value: string | Date | null) => (value ? new Date(value).toISOString() : null);

function historyJson(row: HistoryRow) {
  return {
    id: row.id,
    sku: row.sku,
    name: { ko: row.name_ko, en: row.name_en },
    kind: row.kind,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    provider: row.provider,
    createdAt: iso(row.created_at),
    paidAt: iso(row.paid_at),
    refundedAt: iso(row.refunded_at),
    payment: row.payment_status
      ? {
          status: row.payment_status,
          methodSummary: row.method_summary,
          receiptUrl: row.receipt_url,
        }
      : null,
    refundRequest: row.refund_status
      ? {
          status: row.refund_status,
          requestedAt: iso(row.refund_requested_at),
          resolvedAt: iso(row.refund_resolved_at),
        }
      : null,
  };
}

// The cursor is the last row's creation time and id, base64url so it travels as one token.
const encodeCursor = (row: HistoryRow) =>
  btoa(`${row.cursor_at}|${row.id}`).replace(/\+/g, '-').replace(/\//g, '_');

function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const [at = '', id = ''] = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')).split('|');
    return Number.isNaN(Date.parse(at)) || !UUID.test(id) ? null : { at, id };
  } catch {
    return null;
  }
}

export const myOrderRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .use(requireCookieSession)
  .get('/', async (c) => {
    const parsed = pageQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return validationError(c, parsed.error);
    const before = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : undefined;
    if (before === null) return invalidField(c, 'cursor', 'This is not a cursor of this list.');

    const { items, more } = await listUserOrders(c.var.deps.db, {
      userId: c.var.user.id,
      limit: parsed.data.limit,
      ...(before ? { before } : {}),
    });
    return c.json({
      items: items.map(historyJson),
      nextCursor: more ? encodeCursor(items[items.length - 1]!) : null,
    });
  })
  .get('/:id', async (c) => {
    const id = c.req.param('id');
    const row = UUID.test(id)
      ? await readUserOrder(c.var.deps.db, { userId: c.var.user.id, id })
      : undefined;
    if (!row) return apiError(c, 404, 'not_found', 'There is no such order.');
    return c.json(historyJson(row));
  });
