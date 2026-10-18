import type { Deps } from '../deps';
import { findPayment, settleOrder, type OrderRow } from './order-store';
import type { PaymentProvider, PaymentResult } from './provider';

// What a provider's answer about a pending order does to it, shared by the confirm route (FR-43)
// and the webhooks that catch up a lost confirm (FR-48). Logs carry ids only (NFR-21).

export type Outcome =
  // The order is fulfilled (approved) or failed (declined), or another request settled it first
  | { kind: 'settled' }
  // Approved for another amount or currency and given back (FR-37)
  | { kind: 'mismatch' }
  // Approved for another amount and the cancel failed: the money is held until refunded by hand
  | { kind: 'held' }
  // Approved while the order closed (expired or failed meanwhile) and given back
  | { kind: 'closed' };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function applyProviderResult(
  db: Deps['db'],
  provider: PaymentProvider,
  input: {
    providerId: string;
    order: Pick<OrderRow, 'id' | 'amount' | 'currency'>;
    result: PaymentResult;
  },
): Promise<Outcome> {
  const { order, result, providerId } = input;
  const paymentKey = result.providerPaymentKey;

  if (
    result.status === 'done' &&
    (result.amount !== order.amount || result.currency !== order.currency)
  ) {
    let canceled: PaymentResult;
    try {
      canceled = await provider.cancel({
        providerPaymentKey: paymentKey,
        reason: 'Amount differs from the order.',
      });
    } catch (error) {
      // The payment row keeps `done`: the money is still at the provider.
      await settleOrder(db, {
        orderId: order.id,
        to: 'failed',
        provider: providerId,
        payment: result,
      });
      console.error('payment held after an amount mismatch; refund it by hand', {
        orderId: order.id,
        paymentKey,
        error: message(error),
      });
      return { kind: 'held' };
    }
    await settleOrder(db, {
      orderId: order.id,
      to: 'failed',
      provider: providerId,
      payment: canceled,
    });
    console.warn('approved for another amount; canceled', { orderId: order.id, paymentKey });
    return { kind: 'mismatch' };
  }

  const to = result.status === 'done' ? 'fulfilled' : 'failed';
  const settled = await settleOrder(db, {
    orderId: order.id,
    to,
    provider: providerId,
    payment: result,
  });
  if (!settled && result.status === 'done' && !(await findPayment(db, paymentKey))) {
    await giveBack(provider, { orderId: order.id, paymentKey });
    return { kind: 'closed' };
  }
  console.info('payment settled', { orderId: order.id, paymentKey, status: result.status });
  return { kind: 'settled' };
}

// An approved payment that no order will keep: cancel it, or leave a log for a refund by hand.
export async function giveBack(
  provider: PaymentProvider,
  input: { orderId: string; paymentKey: string },
): Promise<void> {
  await provider
    .cancel({ providerPaymentKey: input.paymentKey, reason: 'The order was closed meanwhile.' })
    .then(() => console.warn('approved for a closed order; canceled', input))
    .catch((error: unknown) =>
      console.error('payment held for a closed order; refund it by hand', {
        ...input,
        error: message(error),
      }),
    );
}
