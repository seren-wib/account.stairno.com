import { Hono, type Context } from 'hono';
import { registerTossCardInputSchema } from '@stairno-account/contract';
import type { AppEnv } from '../deps';
import { apiError, invalidField, validationError } from '../http/errors';
import { requireCookieSession, requireUser } from '../middleware/session';
import { customerKeyFor, decryptBillingKey, encryptBillingKey } from '../payments/billing-keys';
import {
  addPaymentMethod,
  findPaymentMethod,
  listPaymentMethods,
  makeDefaultPaymentMethod,
  paysASubscription,
  removePaymentMethod,
  storedCustomerKey,
  type PaymentMethodRow,
} from '../payments/payment-method-store';
import { PaymentRefused, ProviderError } from '../payments/provider';

// FR-45, FR-53, FR-54, FR-32: the account center's card list. Only its own cookie session may
// change cards (a site never handles them, DR-2), and NFR-5's origin check covers every change.
// The billing key never leaves the API and never reaches a log (DR-4, NFR-21).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function paymentMethodJson(row: PaymentMethodRow) {
  return {
    id: row.id,
    provider: row.provider,
    cardCompany: row.card_company,
    cardLast4: row.card_last4,
    isDefault: row.is_default,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// The cards' own customerKey once there is one, otherwise the one derived for this user.
async function customerKeyOf(c: Context<AppEnv>) {
  const { db, billingKeySecret } = c.var.deps;
  return (
    (await storedCustomerKey(db, c.var.user.id)) ?? customerKeyFor(billingKeySecret, c.var.user.id)
  );
}

const notSetUp = (c: Context<AppEnv>) =>
  apiError(c, 503, 'payments_off', 'Cards cannot be registered right now.');

export const paymentMethodRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .use(requireCookieSession)
  .get('/', async (c) => {
    let customerKey: string;
    try {
      customerKey = await customerKeyOf(c);
    } catch {
      return notSetUp(c);
    }
    const items = await listPaymentMethods(c.var.deps.db, c.var.user.id);
    // The card window opens with this public key; null means it cannot open yet.
    const clientKey = c.var.deps.tossClientKey ?? null;
    return c.json({ items: items.map(paymentMethodJson), customerKey, clientKey });
  })
  .post('/toss', async (c) => {
    const { db, providers, billingKeySecret } = c.var.deps;
    const parsed = registerTossCardInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return validationError(c, parsed.error);
    if (!c.var.user.emailVerified) {
      return apiError(
        c,
        403,
        'email_not_verified',
        'Verify your email address before adding a card.',
      );
    }

    let customerKey: string;
    try {
      customerKey = await customerKeyOf(c);
    } catch {
      return notSetUp(c);
    }
    if (parsed.data.customerKey !== customerKey) {
      return invalidField(c, 'customerKey', 'This is not your customer key.');
    }

    let issued;
    try {
      issued = await providers.toss.issueBillingKey!({ customerKey, authKey: parsed.data.authKey });
    } catch (error) {
      if (error instanceof PaymentRefused) return invalidField(c, 'authKey', error.reason);
      if (!(error instanceof ProviderError)) throw error;
      console.error('toss billing key not issued', { error: error.message });
      return apiError(c, 502, 'provider_error', 'Toss did not answer. Please try again.');
    }

    const method = await addPaymentMethod(db, {
      userId: c.var.user.id,
      provider: 'toss',
      billingKey: await encryptBillingKey(billingKeySecret, issued.billingKey),
      customerKey,
      ...(issued.cardCompany ? { cardCompany: issued.cardCompany } : {}),
      ...(issued.cardLast4 ? { cardLast4: issued.cardLast4 } : {}),
    });
    console.info('payment method added', { paymentMethodId: method.id });
    return c.json({ paymentMethod: paymentMethodJson(method) }, 201);
  })
  .delete('/:id', async (c) => {
    const { db, providers, billingKeySecret } = c.var.deps;
    const id = c.req.param('id');
    const method = UUID.test(id)
      ? await findPaymentMethod(db, { userId: c.var.user.id, id })
      : undefined;
    if (!method) return apiError(c, 404, 'not_found', 'There is no such card.');
    if (await paysASubscription(db, method.id)) {
      return apiError(
        c,
        409,
        'conflict',
        'A subscription pays with this card. Choose another first.',
      );
    }

    // At Toss first: a card we forgot while Toss still holds its key would be worse than one we
    // still list after Toss dropped it.
    try {
      await providers.toss.deleteBillingKey!(
        await decryptBillingKey(billingKeySecret, method.billing_key),
      );
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      console.error('toss billing key not deleted', {
        paymentMethodId: method.id,
        error: error.message,
      });
      return apiError(c, 502, 'provider_error', 'Toss did not answer. Please try again.');
    }
    await removePaymentMethod(db, { userId: c.var.user.id, id: method.id });
    console.info('payment method removed', { paymentMethodId: method.id });
    return c.body(null, 204);
  })
  .patch('/:id/default', async (c) => {
    const { db } = c.var.deps;
    const id = c.req.param('id');
    const method = UUID.test(id)
      ? await findPaymentMethod(db, { userId: c.var.user.id, id })
      : undefined;
    if (!method) return apiError(c, 404, 'not_found', 'There is no such card.');
    await makeDefaultPaymentMethod(db, { userId: c.var.user.id, id: method.id });
    const items = await listPaymentMethods(db, c.var.user.id);
    return c.json({ items: items.map(paymentMethodJson) });
  });
