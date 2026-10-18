import { Hono, type Context } from 'hono';
import { createOrderInputSchema, type CreateOrderInput } from '@stairno-account/contract';
import type { AppEnv } from '../deps';
import { apiError, invalidField, validationError } from '../http/errors';
import { requireSite, verifyAccessToken } from '../middleware/session';
import { decryptBillingKey } from '../payments/billing-keys';
import { requirePayments } from '../payments/mode';
import {
  failPendingOrder,
  findOrderTarget,
  findPayment,
  insertOrder,
  readSiteOrder,
  type OrderRow,
  type PaymentRow,
} from '../payments/order-store';
import { ProviderError } from '../payments/provider';
import { applyProviderResult, giveBack } from '../payments/settle';
import {
  findDefaultCard,
  hasLiveSubscription,
  startSubscription,
  type SubscriptionRow,
} from '../payments/subscription-store';

// FR-35, FR-40. A site creates and reads orders for its signed-in buyer. An order for a
// subscription product is paid at once on the buyer's default card (FR-46).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// KRW goes through Toss, USD through PayPal (DR-5).
const PROVIDER_BY_CURRENCY = { KRW: 'toss', USD: 'paypal' } as const;

const iso = (value: string | Date | null) => (value ? new Date(value).toISOString() : null);

export function orderJson(row: OrderRow) {
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

export function paymentJson(row: PaymentRow) {
  return {
    provider: row.provider,
    status: row.status,
    paymentKey: row.provider_payment_key,
    ...(row.method_summary ? { methodSummary: row.method_summary } : {}),
    ...(row.receipt_url ? { receiptUrl: row.receipt_url } : {}),
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
  };
}

function subscriptionJson(row: SubscriptionRow) {
  return {
    id: row.id,
    status: row.status,
    currentPeriodStart: iso(row.current_period_start),
    currentPeriodEnd: iso(row.current_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}

// FR-46, UC-7 (SDD §6.4): the first payment of a subscription, charged now on the buyer's
// default card. The site gets the settled order back, never a checkout.
async function startSubscriptionOrder(
  c: Context<AppEnv>,
  input: CreateOrderInput & {
    userId: string;
    clientId: string;
    productId: string;
    amount: number;
    orderName: string;
  },
) {
  const { db, providers, billingKeySecret } = c.var.deps;
  // Only Toss keeps cards (DR-5), so subscriptions are sold in KRW.
  if (input.currency !== 'KRW') {
    return invalidField(c, 'currency', 'Subscriptions are paid in KRW with a saved card.');
  }
  if (await hasLiveSubscription(db, input)) {
    return apiError(c, 409, 'conflict', 'The buyer already has this subscription.');
  }
  const card = await findDefaultCard(db, input.userId);
  if (!card) {
    return apiError(
      c,
      409,
      'payment_method_required',
      'The buyer has no card yet. Send them to the account center to add one.',
    );
  }
  let billingKey: string;
  try {
    billingKey = await decryptBillingKey(billingKeySecret, card.billing_key);
  } catch {
    console.error('billing key unreadable', { paymentMethodId: card.id });
    return apiError(c, 503, 'payments_off', 'Cards cannot be charged right now.');
  }

  const order = await insertOrder(db, { ...input, provider: 'toss' });
  let result;
  try {
    result = await providers.toss.chargeBillingKey!({
      billingKey,
      customerKey: card.customer_key,
      order: { id: order.id, amount: order.amount, currency: order.currency },
      orderName: input.orderName,
    });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    // Toss may have charged without its answer reaching us. The order is failed, so a webhook
    // for it later finds no payment here and gives the money back (FR-48).
    await failPendingOrder(db, order.id);
    console.error('subscription charge not answered', { orderId: order.id, error: error.message });
    return apiError(c, 502, 'provider_error', 'Toss did not answer. Please try again.');
  }

  let subscription: SubscriptionRow | undefined;
  if (result.status === 'done' && result.amount === order.amount && result.currency === 'KRW') {
    subscription = await startSubscription(db, {
      orderId: order.id,
      paymentMethodId: card.id,
      provider: 'toss',
      payment: result,
    });
    if (!subscription) {
      await giveBack(providers.toss, { orderId: order.id, paymentKey: result.providerPaymentKey });
      return apiError(c, 409, 'invalid_transition', 'The order closed while it was being paid.');
    }
    console.info('subscription started', { orderId: order.id, subscriptionId: subscription.id });
  } else {
    // A decline, or an approval for another amount: settled like a confirm (FR-37, FR-55).
    const outcome = await applyProviderResult(db, providers.toss, {
      providerId: 'toss',
      order,
      result,
    });
    if (outcome.kind === 'mismatch') {
      return apiError(c, 422, 'amount_mismatch', 'The charged amount is not the order amount.');
    }
    if (outcome.kind === 'held') {
      return apiError(c, 502, 'provider_error', 'The payment could not be canceled.');
    }
  }

  const settled = await readSiteOrder(db, { id: order.id, clientId: c.var.site!.clientId });
  const payment = await findPayment(db, result.providerPaymentKey);
  return c.json(
    {
      order: orderJson(settled ?? order),
      payment: payment ? paymentJson(payment) : null,
      subscription: subscription ? subscriptionJson(subscription) : null,
    },
    201,
  );
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
    // Free products need no order (FR-58).
    if (target.amount === 0) return invalidField(c, 'sku', 'A free product needs no order.');
    if (!site.origins.includes(new URL(input.returnUrl).origin)) {
      return invalidField(c, 'returnUrl', "The return address must be on the site's own origin.");
    }
    const orderName = target.locale === 'en' ? target.name_en! : target.name_ko!;
    if (target.kind === 'subscription') {
      return startSubscriptionOrder(c, {
        ...input,
        userId: buyer.sub,
        clientId: site.clientId,
        productId: target.product_id,
        amount: target.amount,
        orderName,
      });
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
          orderName,
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
