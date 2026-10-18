import type { Deps } from '../deps';
import { findPaymentForOrder, readOrder, refundOrder } from '../payments/order-store';
import { allowedFrom } from '../payments/orders';
import { sendOrderMail } from '../payments/order-mail';
import { endRefundedSubscription, resolveRefundRequest } from '../payments/refund-store';

// FR-64, FR-66 (SDD §6.7). The operator decides a refund; the API never judges the policy. A
// refund cancels the whole payment at its provider first (FR-47), and only then records it: the
// order refunded, the payment canceled, the entitlement revoked (FR-61), a subscription it paid
// for ended, and the open request resolved. A provider failure throws and changes nothing here.
// The provider's webhook for the cancel then finds the order refunded already (FR-48).

type RefundDeps = Pick<Deps, 'db' | 'providers' | 'mailer' | 'origins'>;

export type RefundResult =
  { kind: 'refunded' } | { kind: 'not_found' } | { kind: 'not_refundable'; status: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function refund(
  deps: RefundDeps,
  input: { orderId: string; reason: string },
): Promise<RefundResult> {
  const { db, providers } = deps;
  const order = UUID.test(input.orderId) ? await readOrder(db, { id: input.orderId }) : undefined;
  if (!order) return { kind: 'not_found' };
  const payment = await findPaymentForOrder(db, order.id);
  const refundable = (allowedFrom('refund') as string[]).includes(order.status);
  if (!refundable || payment?.status !== 'done') {
    return { kind: 'not_refundable', status: order.status };
  }

  const provider = providers[order.provider as keyof RefundDeps['providers']];
  const canceled = await provider.cancel({
    providerPaymentKey: payment.provider_payment_key,
    reason: input.reason,
  });
  await refundOrder(db, {
    orderId: order.id,
    providerPaymentKey: payment.provider_payment_key,
    raw: canceled.raw,
  });
  if (order.kind === 'subscription') await endRefundedSubscription(db, order.id);
  await resolveRefundRequest(db, { orderId: order.id, status: 'refunded' });
  console.info('order refunded by the operator', {
    orderId: order.id,
    paymentKey: payment.provider_payment_key,
  });
  // FR-65: the buyer hears the outcome.
  await sendOrderMail(deps, { orderId: order.id, template: 'refunded' });
  return { kind: 'refunded' };
}

export async function rejectRefund(
  deps: Pick<Deps, 'db' | 'mailer' | 'origins'>,
  input: { orderId: string },
): Promise<{ kind: 'rejected' } | { kind: 'no_request' }> {
  if (!UUID.test(input.orderId)) return { kind: 'no_request' };
  const rejected = await resolveRefundRequest(deps.db, {
    orderId: input.orderId,
    status: 'rejected',
  });
  if (rejected) {
    console.info('refund request rejected', { orderId: input.orderId });
    await sendOrderMail(deps, { orderId: input.orderId, template: 'refundRejected' });
  }
  return rejected ? { kind: 'rejected' } : { kind: 'no_request' };
}
