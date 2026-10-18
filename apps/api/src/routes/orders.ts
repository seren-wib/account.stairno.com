import { Hono } from 'hono';
import { createOrderInputSchema } from '@stairno-account/contract';
import type { AppEnv } from '../deps';
import { apiError, invalidField, validationError } from '../http/errors';
import { requireSite, verifyAccessToken } from '../middleware/session';
import { requirePayments } from '../payments/mode';
import {
  findOrderTarget,
  insertOrder,
  readSiteOrder,
  type OrderRow,
} from '../payments/order-store';

// FR-35, FR-40. A site creates and reads orders for its signed-in buyer.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// KRW goes through Toss, USD through PayPal (DR-5).
const PROVIDER_BY_CURRENCY = { KRW: 'toss', USD: 'paypal' } as const;

const iso = (value: string | Date | null) => (value ? new Date(value).toISOString() : null);

function orderJson(row: OrderRow) {
  return {
    id: row.id,
    status: row.status,
    sku: row.sku,
    currency: row.currency,
    amount: row.amount,
    provider: row.provider,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    paidAt: iso(row.paid_at),
    fulfilledAt: iso(row.fulfilled_at),
    refundedAt: iso(row.refunded_at),
  };
}

export const orderRoutes = new Hono<AppEnv>()
  .use(requireSite)
  .post('/', requirePayments, async (c) => {
    const { auth, db } = c.var.deps;
    const site = c.var.site!;

    // The buyer is the user of the access token the site forwards, issued to this same site; a
    // user id in the body is never read (FR-35, SDD §8).
    const userToken = c.req.header('x-user-token');
    const buyer = userToken ? await verifyAccessToken(auth, userToken) : null;
    if (!buyer || buyer.sub === buyer.azp) {
      return apiError(c, 401, 'unauthorized', "Send the buyer's access token in X-User-Token.");
    }
    if (buyer.azp !== site.clientId) {
      return apiError(c, 403, 'forbidden', 'The buyer token was issued to another site.');
    }

    const parsed = createOrderInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return validationError(c, parsed.error);
    const input = parsed.data;

    const target = await findOrderTarget(db, {
      userId: buyer.sub,
      clientId: site.clientId,
      sku: input.sku,
      currency: input.currency,
    });
    if (!target) return apiError(c, 401, 'unauthorized', 'The buyer is not a Stairno user.');
    if (!target.email_verified) {
      return apiError(c, 403, 'email_not_verified', 'Verify your email address before buying.');
    }
    if (!target.product_id) return apiError(c, 404, 'not_found', 'There is no such product.');
    if (target.amount === null) {
      return invalidField(c, 'currency', 'The product has no price in this currency.');
    }
    // Subscriptions start on a saved card (FR-46) and free products need no order (FR-58).
    if (target.kind !== 'one_time') {
      return invalidField(c, 'sku', 'Subscriptions are not sold as one-time orders.');
    }
    if (target.amount === 0) return invalidField(c, 'sku', 'A free product needs no order.');
    if (!site.origins.includes(new URL(input.returnUrl).origin)) {
      return invalidField(c, 'returnUrl', "The return address must be on the site's own origin.");
    }

    const provider = PROVIDER_BY_CURRENCY[input.currency];
    const order = await insertOrder(db, {
      userId: buyer.sub,
      clientId: site.clientId,
      productId: target.product_id,
      sku: input.sku,
      currency: input.currency,
      amount: target.amount,
      provider,
      returnUrl: input.returnUrl,
    });
    // NFR-21: the order id and the provider, nothing about the buyer.
    console.info('order created', { orderId: order.id, provider });

    return c.json(
      {
        order: orderJson(order),
        // What the site's checkout needs to start the provider's payment (SDD §6.3, §6.5).
        checkout: {
          provider,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          orderName: target.locale === 'en' ? target.name_en : target.name_ko,
        },
      },
      201,
    );
  })
  .get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return apiError(c, 404, 'not_found', 'There is no such order.');

    const order = await readSiteOrder(c.var.deps.db, { id, clientId: c.var.site!.clientId });
    if (!order) return apiError(c, 404, 'not_found', 'There is no such order.');
    return c.json(orderJson(order));
  });
