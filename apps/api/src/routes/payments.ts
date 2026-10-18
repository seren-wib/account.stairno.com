import { Hono, type Context } from 'hono';
import { confirmTossPaymentInputSchema, paypalOrderInputSchema } from '@stairno-account/contract';
import type { AppEnv } from '../deps';
import { apiError, invalidField, validationError } from '../http/errors';
import { requireSite } from '../middleware/session';
import { requirePayments } from '../payments/mode';
import {
  failPendingOrder,
  findPayment,
  findPaymentForOrder,
  readSiteOrder,
  setProviderOrderId,
  type OrderRow,
  type PaymentRow,
} from '../payments/order-store';
import { ProviderError, type Checkout, type PaymentResult } from '../payments/provider';
import { applyProviderResult, type Outcome } from '../payments/settle';
import { orderJson } from './orders';

// FR-43, FR-44, FR-37, FR-38, FR-39 (SDD §6.3) for Toss, FR-49, FR-50 (SDD §6.5) for PayPal.
// The provider is asked through its adapter, the amount is checked again on what it approved,
// and the order settles through payments/settle.ts. Logs carry ids only (NFR-21).

function paymentJson(row: PaymentRow) {
  return {
    provider: row.provider,
    status: row.status,
    paymentKey: row.provider_payment_key,
    ...(row.method_summary ? { methodSummary: row.method_summary } : {}),
    ...(row.receipt_url ? { receiptUrl: row.receipt_url } : {}),
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
  };
}

// Every answer about a payment is read back from the database, so a repeated or concurrent
// confirm gets exactly the first one (FR-38).
async function answer(c: Context<AppEnv>, orderId: string, paymentKey: string) {
  const { db } = c.var.deps;
  const order = await readSiteOrder(db, { id: orderId, clientId: c.var.site!.clientId });
  const payment = await findPayment(db, paymentKey);
  if (!order || !payment) {
    return apiError(c, 409, 'conflict', 'The order changed while it was being confirmed.');
  }
  return c.json({ order: orderJson(order), payment: paymentJson(payment) });
}

export const paymentRoutes = new Hono<AppEnv>()
  .use(requireSite)
  .post('/toss/confirm', requirePayments, async (c) => {
    const { db, providers } = c.var.deps;
    const parsed = confirmTossPaymentInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return validationError(c, parsed.error);
    const { paymentKey, orderId, amount } = parsed.data;

    // Reading the order also expires it if its 30 minutes are over (FR-36).
    const order = await readSiteOrder(db, { id: orderId, clientId: c.var.site!.clientId });
    if (!order) return apiError(c, 404, 'not_found', 'There is no such order.');
    if (order.provider !== 'toss') {
      return invalidField(c, 'orderId', 'This order is not paid through Toss.');
    }

    // FR-38: this payment key was confirmed before.
    const known = await findPayment(db, paymentKey);
    if (known) {
      if (known.order_id !== order.id) {
        return apiError(c, 409, 'conflict', 'This payment belongs to another order.');
      }
      return answer(c, order.id, paymentKey);
    }

    if (order.status !== 'pending') {
      return apiError(c, 409, 'invalid_transition', `The order is ${order.status}.`);
    }

    // FR-44: the amount from the redirect is not the order's; Toss is not asked.
    if (amount !== order.amount) {
      await failPendingOrder(db, order.id);
      console.warn('toss confirm with another amount', { orderId: order.id, paymentKey });
      return apiError(c, 422, 'amount_mismatch', 'The amount is not the order amount.');
    }

    let result: PaymentResult;
    try {
      result = await providers.toss.confirm({
        order: { id: order.id, amount: order.amount, currency: order.currency },
        providerPaymentKey: paymentKey,
        amount: order.amount,
        currency: order.currency,
      });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      console.error('toss confirm failed', { orderId: order.id, paymentKey, error: error.message });
      return apiError(c, 502, 'provider_error', 'Toss did not answer. Please try again.');
    }

    // FR-37, FR-39: the amount is checked again on what Toss approved, then the order settles.
    const outcome = await applyProviderResult(db, providers.toss, {
      providerId: 'toss',
      order,
      result,
    });
    return respond(c, outcome, order, paymentKey);
  })
  // FR-49: a PayPal order for one of the site's pending USD orders. Asking again answers with the
  // same PayPal order: the create call carries our order id as its PayPal-Request-Id.
  .post('/paypal/orders', requirePayments, async (c) => {
    const { db, providers } = c.var.deps;
    const parsed = paypalOrderInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return validationError(c, parsed.error);

    const order = await readSiteOrder(db, {
      id: parsed.data.orderId,
      clientId: c.var.site!.clientId,
    });
    if (!order) return apiError(c, 404, 'not_found', 'There is no such order.');
    if (order.provider !== 'paypal') {
      return invalidField(c, 'orderId', 'This order is not paid through PayPal.');
    }
    if (order.status !== 'pending') {
      return apiError(c, 409, 'invalid_transition', `The order is ${order.status}.`);
    }

    let checkout: Checkout;
    try {
      checkout = await providers.paypal.createCheckout!({
        order: { id: order.id, amount: order.amount, currency: order.currency },
        returnUrl: order.return_url!,
        cancelUrl: order.return_url!,
      });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      console.error('paypal order not created', { orderId: order.id, error: error.message });
      return apiError(c, 502, 'provider_error', 'PayPal did not answer. Please try again.');
    }
    if (
      !(await setProviderOrderId(db, {
        orderId: order.id,
        providerOrderId: checkout.providerOrderId,
      }))
    ) {
      return apiError(c, 409, 'invalid_transition', 'The order closed meanwhile.');
    }
    console.info('paypal order', { orderId: order.id, paypalOrderId: checkout.providerOrderId });
    return c.json({
      orderId: order.id,
      paypalOrderId: checkout.providerOrderId,
      approvalUrl: checkout.approvalUrl,
    });
  })
  // FR-49, FR-50: back from PayPal, the site asks for the capture. The PayPal order id comes from
  // our order, never from the site.
  .post('/paypal/capture', requirePayments, async (c) => {
    const { db, providers } = c.var.deps;
    const parsed = paypalOrderInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return validationError(c, parsed.error);

    const order = await readSiteOrder(db, {
      id: parsed.data.orderId,
      clientId: c.var.site!.clientId,
    });
    if (!order) return apiError(c, 404, 'not_found', 'There is no such order.');
    if (order.provider !== 'paypal') {
      return invalidField(c, 'orderId', 'This order is not paid through PayPal.');
    }

    // FR-38: captured before; the capture id is only known after the call, so look by order.
    const known = await findPaymentForOrder(db, order.id);
    if (known) return answer(c, order.id, known.provider_payment_key);

    if (order.status !== 'pending') {
      return apiError(c, 409, 'invalid_transition', `The order is ${order.status}.`);
    }
    if (!order.provider_order_id) {
      return apiError(c, 409, 'conflict', 'Create the PayPal order first.');
    }

    let result: PaymentResult;
    try {
      result = await providers.paypal.confirm({
        order: { id: order.id, amount: order.amount, currency: order.currency },
        providerPaymentKey: order.provider_order_id,
        amount: order.amount,
        currency: order.currency,
      });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      console.error('paypal capture failed', { orderId: order.id, error: error.message });
      return apiError(c, 502, 'provider_error', 'PayPal did not answer. Please try again.');
    }

    const outcome = await applyProviderResult(db, providers.paypal, {
      providerId: 'paypal',
      order,
      result,
    });
    return respond(c, outcome, order, result.providerPaymentKey);
  });

function respond(c: Context<AppEnv>, outcome: Outcome, order: OrderRow, paymentKey: string) {
  switch (outcome.kind) {
    case 'mismatch':
      return apiError(c, 422, 'amount_mismatch', 'The approved amount is not the order amount.');
    case 'held':
      return apiError(c, 502, 'provider_error', 'The payment could not be canceled.');
    case 'closed':
      return apiError(c, 409, 'invalid_transition', 'The order closed while it was being paid.');
    case 'pending':
      // The payer has not approved yet: the site may send them back to the provider.
      return c.json({ order: orderJson(order) }, 202);
    case 'settled':
      return answer(c, order.id, paymentKey);
  }
}
