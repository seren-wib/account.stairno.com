import { sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { decryptBillingKey } from './billing-keys';

// FR-8: before an account is deleted, every live card's billing key is removed at its provider.
// Each card is marked removed as soon as its key is gone, so a retry after a failure only asks
// about the rest. A provider that cannot be reached throws (ProviderError) and the deletion waits;
// a key that can no longer be decrypted cannot be removed by us either, so it is logged by card
// id for a removal by hand and does not hold the deletion up. Logs carry ids only (NFR-21).
export async function removeBillingKeysOf(
  deps: Pick<Deps, 'db' | 'providers' | 'billingKeySecret'>,
  userId: string,
): Promise<void> {
  const { db, providers, billingKeySecret } = deps;
  const cards = (
    (await db.execute(sql`
      select id, provider, billing_key from payment_method
      where user_id = ${userId} and deleted_at is null`)) as {
      rows: { id: string; provider: string; billing_key: string }[];
    }
  ).rows;

  for (const card of cards) {
    let billingKey: string;
    try {
      billingKey = await decryptBillingKey(billingKeySecret, card.billing_key);
    } catch {
      console.error('billing key unreadable; remove it at the provider by hand', {
        paymentMethodId: card.id,
        provider: card.provider,
      });
      continue;
    }
    const provider = providers[card.provider as keyof Deps['providers']];
    if (!provider?.deleteBillingKey) {
      console.error('no provider can remove this billing key', { paymentMethodId: card.id });
      continue;
    }
    await provider.deleteBillingKey(billingKey);
    await db.execute(sql`
      update payment_method set deleted_at = now(), is_default = false where id = ${card.id}`);
    console.info('billing key removed with the account', { paymentMethodId: card.id });
  }
}
