import { Hono } from 'hono';
import { refundRequestInputSchema } from '@stairno-account/contract';
import type { AppEnv } from '../deps';
import { apiError, validationError } from '../http/errors';
import {
  requireCookieSession,
  requireSite,
  requireUser,
  verifyAccessToken,
} from '../middleware/session';
import {
  fileRefundRequest,
  listRefundRequests,
  type RefundRequestRow,
} from '../payments/refund-store';

// FR-63, FR-66 (SDD §6.7). A site files its buyer's refund request; the account center shows
// the user's requests. An operator decides them with the refund command (FR-64). Logs carry ids.

const iso = (value: string | Date | null) => (value ? new Date(value).toISOString() : null);

function requestJson(row: RefundRequestRow) {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    requestedAt: iso(row.requested_at),
    resolvedAt: iso(row.resolved_at),
  };
}

export const refundRequestRoutes = new Hono<AppEnv>()
  .post('/', requireSite, async (c) => {
    const { auth, db } = c.var.deps;
    const site = c.var.site!;

    // As for orders: the buyer is the user of the token the site forwards, issued to this same
    // site; a user id in the body is never read (FR-35, SDD §8).
    const userToken = c.req.header('x-user-token');
    const buyer = userToken ? await verifyAccessToken(auth, userToken) : null;
    if (!buyer || buyer.sub === buyer.azp) {
      return apiError(c, 401, 'unauthorized', "Send the buyer's access token in X-User-Token.");
    }
    if (buyer.azp !== site.clientId) {
      return apiError(c, 403, 'forbidden', 'The buyer token was issued to another site.');
    }

    const parsed = refundRequestInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return validationError(c, parsed.error);

    const filed = await fileRefundRequest(db, {
      orderId: parsed.data.orderId,
      userId: buyer.sub,
      clientId: site.clientId,
      reason: parsed.data.reason,
    });
    switch (filed.kind) {
      case 'not_found':
        return apiError(c, 404, 'not_found', 'There is no such order.');
      case 'not_refundable':
        return apiError(c, 409, 'invalid_transition', `The order is ${filed.status}.`);
      case 'already_open':
        return apiError(c, 409, 'conflict', 'A refund request for this order is already open.');
      case 'filed':
        console.info('refund requested', { orderId: filed.request.order_id });
        return c.json(requestJson(filed.request), 201);
    }
  })
  .get('/', requireUser, requireCookieSession, async (c) => {
    const items = await listRefundRequests(c.var.deps.db, c.var.user.id);
    return c.json({
      items: items.map((row) => ({
        ...requestJson(row),
        sku: row.sku,
        name: { ko: row.name_ko, en: row.name_en },
        amount: row.amount,
        currency: row.currency,
      })),
      nextCursor: null,
    });
  });
