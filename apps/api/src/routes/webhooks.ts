import { Hono } from 'hono';
import type { AppEnv, Deps } from '../deps';
import { apiError } from '../http/errors';
import { findPayment, readOrder, refundOrder, settleOrder } from '../payments/order-store';
import { ProviderError, type WebhookEvent } from '../payments/provider';
import { applyProviderResult, giveBack } from '../payments/settle';
import { finishWebhookEvent, receiveWebhookEvent } from '../payments/webhook-store';

// FR-48, FR-67 to FR-70 (SDD §6.6). A provider tells us a payment changed. The adapter verifies
// the webhook first (Toss's is unsigned, so it reads the payment back), the event is kept once,
// and the order is brought in step with the payment as the provider reports it now. Payments
// being off does not stop this: it keeps records true (NFR-11). Logs carry ids only (NFR-21).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function applyTossEvent(deps: Deps, event: WebhookEvent): Promise<void> {
  const { db, providers } = deps;
  const payment = event.payment;
  if (!payment || !event.orderRef || !UUID.test(event.orderRef)) return;
  const order = await readOrder(db, { id: event.orderRef });
  if (!order || order.provider !== 'toss') return;
  const paymentKey = payment.providerPaymentKey;

  switch (payment.status) {
    case 'done':
      if (order.status === 'pending') {
        // The confirm reached Toss but its answer never reached us: catch it up (FR-48, FR-39).
        await applyProviderResult(db, providers.toss, {
          providerId: 'toss',
          order,
          result: payment,
        });
      } else if (!(await findPayment(db, paymentKey))) {
        // Approved for an order that closed without recording it: the money goes back.
        await giveBack(providers.toss, { orderId: order.id, paymentKey });
      }
      return;
    case 'canceled':
      // A refund at Toss, or our own cancel arriving back (FR-61).
      await refundOrder(db, {
        orderId: order.id,
        providerPaymentKey: paymentKey,
        raw: payment.raw,
      });
      return;
    case 'failed':
      if (order.status === 'pending') {
        await settleOrder(db, { orderId: order.id, to: 'failed', provider: 'toss', payment });
      }
      return;
  }
}

export const webhookRoutes = new Hono<AppEnv>().post('/toss', async (c) => {
  const deps = c.var.deps;

  let event: WebhookEvent | null;
  try {
    event = await deps.providers.toss.verifyWebhook(c.req.raw);
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    // Toss could not be asked; a non-200 makes it send the webhook again (FR-69).
    console.error('toss webhook not verified yet', { error: error.message });
    return apiError(c, 502, 'provider_error', 'The payment could not be checked.');
  }
  if (!event) {
    console.warn('toss webhook could not be verified');
    return apiError(c, 400, 'validation_failed', 'The webhook could not be verified.');
  }

  const id = await receiveWebhookEvent(deps.db, {
    provider: 'toss',
    eventId: event.eventId,
    eventType: event.eventType,
    payload: event.raw,
  });
  if (!id) return c.json({ received: true });

  try {
    await applyTossEvent(deps, event);
    await finishWebhookEvent(deps.db, id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await finishWebhookEvent(deps.db, id, reason).catch(() => {});
    console.error('toss webhook failed', { eventId: event.eventId, error: reason });
    return apiError(c, 500, 'internal_error', 'The webhook could not be processed.');
  }
  console.info('toss webhook', { eventId: event.eventId, status: event.status });
  return c.json({ received: true });
});
