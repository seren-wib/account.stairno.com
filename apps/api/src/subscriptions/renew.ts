import type { Deps } from '../deps';
import { decryptBillingKey } from '../payments/billing-keys';
import { failPendingOrder, insertOrder } from '../payments/order-store';
import { ProviderError } from '../payments/provider';
import { applyProviderResult, giveBack } from '../payments/settle';
import {
  claimAttempt,
  dueSubscriptions,
  endAtPeriodEnd,
  failRenewal,
  findDefaultCard,
  renewSubscription,
  type DueSubscription,
} from '../payments/subscription-store';

// FR-46, FR-55 to FR-57 (SDD §6.4): the daily cron. Each due subscription is charged on a new
// order on the buyer's default card (live subscriptions follow it, FR-54), at most once a day and
// at most `limit` per run; the rest wait for the next day. One subscription failing never stops
// the others. Logs carry ids only (NFR-21).

type RenewDeps = Pick<Deps, 'db' | 'providers' | 'billingKeySecret' | 'origins' | 'paymentsMode'>;

export interface RenewalSummary {
  renewed: number;
  failed: number;
  expired: number;
  canceled: number;
  // Toss gave no answer, or the attempt was taken by another run: tried again another day
  skipped: number;
}

type Result = 'renewed' | 'failed' | 'expired' | 'canceled' | 'skipped';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function fail(db: RenewDeps['db'], id: string): Promise<Result> {
  return (await failRenewal(db, id)) === 'expired' ? 'expired' : 'failed';
}

async function renewOne(deps: RenewDeps, sub: DueSubscription): Promise<Result> {
  const { db, providers, billingKeySecret, origins } = deps;
  if (sub.cancel_at_period_end) {
    return (await endAtPeriodEnd(db, sub.id)) ? 'canceled' : 'skipped';
  }
  if (!(await claimAttempt(db, sub.id))) return 'skipped';

  const card = await findDefaultCard(db, sub.user_id);
  if (!card || sub.amount === null || sub.amount <= 0) {
    console.error('subscription cannot be charged', {
      subscriptionId: sub.id,
      reason: card ? 'no KRW price' : 'no card',
    });
    return fail(db, sub.id);
  }
  let billingKey: string;
  try {
    billingKey = await decryptBillingKey(billingKeySecret, card.billing_key);
  } catch {
    console.error('billing key unreadable', { subscriptionId: sub.id, paymentMethodId: card.id });
    return fail(db, sub.id);
  }

  // The cron sends nobody anywhere; the order's return address is the account center.
  const order = await insertOrder(db, {
    userId: sub.user_id,
    clientId: sub.client_id,
    productId: sub.product_id,
    sku: sub.sku,
    currency: 'KRW',
    amount: sub.amount,
    provider: 'toss',
    returnUrl: `${origins.account}/`,
  });
  let result;
  try {
    result = await providers.toss.chargeBillingKey!({
      billingKey,
      customerKey: card.customer_key,
      order: { id: order.id, amount: order.amount, currency: order.currency },
      orderName: sub.order_name,
    });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    // Today's attempt is spent; tomorrow's run tries again. A charge Toss made anyway comes back
    // as a webhook for a failed order and is given back (FR-48).
    await failPendingOrder(db, order.id);
    console.error('renewal not answered', {
      subscriptionId: sub.id,
      orderId: order.id,
      error: error.message,
    });
    return 'skipped';
  }

  if (result.status === 'done' && result.amount === order.amount && result.currency === 'KRW') {
    const renewed = await renewSubscription(db, {
      subscriptionId: sub.id,
      orderId: order.id,
      paymentMethodId: card.id,
      provider: 'toss',
      payment: result,
    });
    if (!renewed) {
      await giveBack(providers.toss, { orderId: order.id, paymentKey: result.providerPaymentKey });
      return 'skipped';
    }
    console.info('subscription renewed', { subscriptionId: sub.id, orderId: order.id });
    return 'renewed';
  }

  // A decline, or an approval for another amount that is given back (FR-37, FR-55).
  await applyProviderResult(db, providers.toss, { providerId: 'toss', order, result });
  console.warn('renewal declined', { subscriptionId: sub.id, orderId: order.id });
  return fail(db, sub.id);
}

export async function renewDueSubscriptions(
  deps: RenewDeps,
  { limit = 50 }: { limit?: number } = {},
): Promise<RenewalSummary> {
  const summary: RenewalSummary = { renewed: 0, failed: 0, expired: 0, canceled: 0, skipped: 0 };
  // FR-42: off stops payments, renewals included; due subscriptions wait until it is back on.
  if (deps.paymentsMode === 'off') return summary;
  for (const sub of await dueSubscriptions(deps.db, limit)) {
    let result: Result;
    try {
      result = await renewOne(deps, sub);
    } catch (error) {
      console.error('renewal failed', { subscriptionId: sub.id, error: message(error) });
      result = 'skipped';
    }
    summary[result] += 1;
    // An expired subscription also counts as a failed charge.
    if (result === 'expired') summary.failed += 1;
  }
  console.info('renewal run', summary);
  return summary;
}
