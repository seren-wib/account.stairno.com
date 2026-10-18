import { Hono, type Context } from 'hono';
import type { AppEnv, Deps } from '../deps';
import { apiError } from '../http/errors';
import { findPayment, readOrder, refundOrder, settleOrder } from '../payments/order-store';
import { sendOrderMail } from '../payments/order-mail';
import { ProviderError, type WebhookEvent } from '../payments/provider';
import { applyProviderResult, giveBack } from '../payments/settle';
import { finishWebhookEvent, receiveWebhookEvent } from '../payments/webhook-store';

// FR-48, FR-52, FR-67 to FR-70 (SDD §6.6). A provider tells us a payment changed. The adapter
// verifies the webhook first (Toss's is unsigned and is read back; PayPal's signature is checked
// with PayPal and the capture read back), the event is kept once, and the order is brought in step
// with the payment as the provider reports it now. Payments being off does not stop this: it keeps
// records true (NFR-11). Logs carry ids only (NFR-21).

type ProviderName = keyof Deps['providers'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function applyEvent(deps: Deps, providerId: ProviderName, event: WebhookEvent) {
  const { db } = deps;
  const provider = deps.providers[providerId];
  const payment = event.payment;
  if (!payment || !event.orderRef || !UUID.test(event.orderRef)) return;
  const order = await readOrder(db, { id: event.orderRef });
  if (!order || order.provider !== providerId) return;
  // A subscription order is charged by the API itself (the order route, the renewal cron), which
  // settles it with the subscription; settled here, it would get a permanent entitlement (FR-46).
  if (order.kind === 'subscription' && order.status === 'pending') return;
  const paymentKey = payment.providerPaymentKey;

  switch (payment.status) {
    case 'done':
      if (order.status === 'pending') {
        // The confirm or capture reached the provider but its answer never reached us: catch it
        // up, with the same amount check (FR-48, FR-37, FR-39).
        await applyProviderResult(db, provider, { providerId, order, result: payment });
        if ((await readOrder(db, { id: order.id }))?.status === 'fulfilled') {
          await sendOrderMail(deps, { orderId: order.id, template: 'receipt' });
        }
      } else if (!(await findPayment(db, paymentKey))) {
        // Approved for an order that closed without recording it: the money goes back.
        await giveBack(provider, { orderId: order.id, paymentKey });
      }
      return;
    case 'canceled':
      // A refund at the provider, or our own cancel coming back (FR-51, FR-61).
      // A refund made at the provider's dashboard gets the same mail as one made here (FR-65).
      if (
        await refundOrder(db, {
          orderId: order.id,
          providerPaymentKey: paymentKey,
          raw: payment.raw,
        })
      ) {
        await sendOrderMail(deps, { orderId: order.id, template: 'refunded' });
      }
      return;
    case 'failed':
      if (order.status === 'pending') {
        await settleOrder(db, { orderId: order.id, to: 'failed', provider: providerId, payment });
      }
      return;
    case 'pending':
      return;
  }
}

async function receive(c: Context<AppEnv>, providerId: ProviderName) {
  const deps = c.var.deps;

  let event: WebhookEvent | null;
  try {
    event = await deps.providers[providerId].verifyWebhook(c.req.raw);
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    // The provider could not be asked; a non-200 makes it send the webhook again (FR-69).
    console.error('webhook not verified yet', { provider: providerId, error: error.message });
    return apiError(c, 502, 'provider_error', 'The payment could not be checked.');
  }
  if (!event) {
    console.warn('webhook could not be verified', { provider: providerId });
    return apiError(c, 400, 'validation_failed', 'The webhook could not be verified.');
  }

  const id = await receiveWebhookEvent(deps.db, {
    provider: providerId,
    eventId: event.eventId,
    eventType: event.eventType,
    payload: event.raw,
  });
  if (!id) return c.json({ received: true });

  try {
    await applyEvent(deps, providerId, event);
    await finishWebhookEvent(deps.db, id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await finishWebhookEvent(deps.db, id, reason).catch(() => {});
    console.error('webhook failed', {
      provider: providerId,
      eventId: event.eventId,
      error: reason,
    });
    return apiError(c, 500, 'internal_error', 'The webhook could not be processed.');
  }
  console.info('webhook', { provider: providerId, eventId: event.eventId, status: event.status });
  return c.json({ received: true });
}

export const webhookRoutes = new Hono<AppEnv>()
  .post('/toss', (c) => receive(c, 'toss'))
  .post('/paypal', (c) => receive(c, 'paypal'));
