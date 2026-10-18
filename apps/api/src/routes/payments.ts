import { Hono, type Context } from 'hono';
import { confirmTossPaymentInputSchema } from '@stairno-account/contract';
import type { AppEnv } from '../deps';
import { apiError, invalidField, validationError } from '../http/errors';
import { requireSite } from '../middleware/session';
import { requirePayments } from '../payments/mode';
import {
  failPendingOrder,
  findPayment,
  readSiteOrder,
  settleOrder,
  type PaymentRow,
} from '../payments/order-store';
import { ProviderError, type PaymentResult } from '../payments/provider';
import { orderJson } from './orders';

// FR-43, FR-44, FR-37, FR-38, FR-39 (SDD §6.3). The site sends what Toss's success redirect gave
// it; the API confirms with Toss through the adapter, checks the amount both before and after,
// and fulfils the order. Logs carry the order id and the payment key only (NFR-21).

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

    if (
      result.status === 'done' &&
      (result.amount !== order.amount || result.currency !== order.currency)
    ) {
      // FR-37: Toss approved something other than the order. Give the money back and fail it.
      let canceled: PaymentResult;
      try {
        canceled = await providers.toss.cancel({
          providerPaymentKey: paymentKey,
          reason: 'Amount differs from the order.',
        });
      } catch (error) {
        // The money stays at Toss until the operator refunds it; the payment row says so.
        await settleOrder(db, {
          orderId: order.id,
          to: 'failed',
          provider: 'toss',
          payment: result,
        });
        console.error('toss payment held after an amount mismatch; refund it by hand', {
          orderId: order.id,
          paymentKey,
          error: error instanceof Error ? error.message : String(error),
        });
        return apiError(c, 502, 'provider_error', 'The payment could not be canceled.');
      }
      await settleOrder(db, {
        orderId: order.id,
        to: 'failed',
        provider: 'toss',
        payment: canceled,
      });
      console.warn('toss approved another amount; canceled', { orderId: order.id, paymentKey });
      return apiError(c, 422, 'amount_mismatch', 'The approved amount is not the order amount.');
    }

    const to = result.status === 'done' ? 'fulfilled' : 'failed';
    const settled = await settleOrder(db, {
      orderId: order.id,
      to,
      provider: 'toss',
      payment: result,
    });
    if (!settled && result.status === 'done' && !(await findPayment(db, paymentKey))) {
      // The order left pending while Toss was approving (it expired or failed meanwhile), and no
      // other request recorded this payment: the money must not stay taken.
      await providers.toss
        .cancel({ providerPaymentKey: paymentKey, reason: 'The order was closed meanwhile.' })
        .catch((error: unknown) =>
          console.error('toss payment held for a closed order; refund it by hand', {
            orderId: order.id,
            paymentKey,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return apiError(c, 409, 'invalid_transition', 'The order closed while it was being paid.');
    }
    console.info('toss confirm', { orderId: order.id, paymentKey, status: result.status });
    return answer(c, order.id, paymentKey);
  });
