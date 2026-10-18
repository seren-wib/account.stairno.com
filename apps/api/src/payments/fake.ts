import {
  ProviderError,
  type BillingKey,
  type PaymentProvider,
  type PaymentResult,
  type WebhookEvent,
} from './provider';

// NFR-16: the provider every payment test runs on. By default it approves what it is asked for;
// a test scripts the next answers with willDecline, willApproveAmount or willThrow, played in the
// order given. It keeps the payments and billing keys it has seen, so a repeated confirm answers
// like the real providers do, and it records every call.

type Next =
  | { kind: 'decline'; reason: string }
  | { kind: 'amount'; amount: number }
  | { kind: 'throw'; message: string };

export interface FakeCall {
  method: 'confirm' | 'cancel' | 'issueBillingKey' | 'deleteBillingKey' | 'chargeBillingKey';
  input: unknown;
}

const SIGNATURE_HEADER = 'x-fake-signature';
const VALID_SIGNATURE = 'fake-valid';

export function createFakeProvider({ delayMs = 0 }: { delayMs?: number } = {}) {
  const payments = new Map<string, PaymentResult>();
  const billingKeys = new Map<string, BillingKey>();
  const calls: FakeCall[] = [];
  const script: Next[] = [];
  let issued = 0;

  async function answer(method: FakeCall['method'], input: unknown) {
    calls.push({ method, input });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const scripted = script.shift();
    if (scripted?.kind === 'throw') throw new ProviderError('fake', scripted.message);
    return scripted;
  }

  function settle(
    key: string,
    amount: number,
    currency: string,
    scripted: Next | undefined,
  ): PaymentResult {
    const result: PaymentResult =
      scripted?.kind === 'decline'
        ? {
            status: 'failed',
            providerPaymentKey: key,
            amount,
            currency,
            failureReason: scripted.reason,
            raw: { fake: true },
          }
        : {
            status: 'done',
            providerPaymentKey: key,
            amount: scripted?.kind === 'amount' ? scripted.amount : amount,
            currency,
            methodSummary: 'Fake Card ****4242',
            receiptUrl: `https://fake.invalid/receipts/${key}`,
            raw: { fake: true },
          };
    payments.set(key, result);
    return result;
  }

  const provider = {
    id: 'fake',

    async confirm(input) {
      const known = payments.get(input.providerPaymentKey);
      if (known) {
        calls.push({ method: 'confirm', input });
        return known;
      }
      const scripted = await answer('confirm', input);
      return settle(input.providerPaymentKey, input.amount, input.currency, scripted);
    },

    async cancel(input) {
      await answer('cancel', input);
      const known = payments.get(input.providerPaymentKey);
      if (!known) throw new ProviderError('fake', 'No such payment.');
      const canceled: PaymentResult = { ...known, status: 'canceled' };
      payments.set(input.providerPaymentKey, canceled);
      return canceled;
    },

    async issueBillingKey(input) {
      await answer('issueBillingKey', input);
      issued += 1;
      const key: BillingKey = {
        billingKey: `fake_billing_${issued}`,
        customerKey: input.customerKey,
        cardCompany: 'Fake Card',
        cardLast4: '4242',
      };
      billingKeys.set(key.billingKey, key);
      return key;
    },

    async deleteBillingKey(billingKey) {
      await answer('deleteBillingKey', billingKey);
      billingKeys.delete(billingKey);
    },

    async chargeBillingKey(input) {
      const scripted = await answer('chargeBillingKey', input);
      const key = `fake_charge_${input.order.id}`;
      if (!billingKeys.has(input.billingKey)) {
        return settle(key, input.order.amount, input.order.currency, {
          kind: 'decline',
          reason: 'Unknown billing key.',
        });
      }
      return settle(key, input.order.amount, input.order.currency, scripted);
    },

    async verifyWebhook(req) {
      if (req.headers.get(SIGNATURE_HEADER) !== VALID_SIGNATURE) return null;
      const body = (await req.json()) as Omit<WebhookEvent, 'raw'>;
      return { ...body, raw: body };
    },
  } satisfies PaymentProvider;

  return {
    ...provider,
    calls,

    willDecline(reason = 'Declined by the fake provider.') {
      script.push({ kind: 'decline', reason });
    },
    willApproveAmount(amount: number) {
      script.push({ kind: 'amount', amount });
    },
    willThrow(message = 'The fake provider is unreachable.') {
      script.push({ kind: 'throw', message });
    },

    // A webhook as the fake provider would send it; pass another signature to forge one.
    webhookRequest(
      event: Omit<WebhookEvent, 'raw'>,
      { signature = VALID_SIGNATURE }: { signature?: string } = {},
    ) {
      return new Request('https://api.stairno.com/webhooks/fake', {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signature },
        body: JSON.stringify(event),
      });
    },
  };
}

export type FakeProvider = ReturnType<typeof createFakeProvider>;
