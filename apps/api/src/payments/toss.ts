import type { PaymentsMode } from './mode';
import {
  PaymentRefused,
  ProviderError,
  type PaymentProvider,
  type PaymentResult,
} from './provider';

// FR-43, FR-47: Toss Payments behind PaymentProvider (NFR-13). Core API v1 with Basic auth on the
// secret key (`base64(secretKey + ':')`). Every POST carries an Idempotency-Key, which Toss keeps
// for 15 days and answers again with the first response.

const BASE_URL = 'https://api.tosspayments.com';

// Toss answers these when the request did not go through for reasons on our side or theirs, not
// because the buyer's payment was refused. Everything else in 4xx is a refusal (card declines come
// as 403 or 400, so the code decides, not the status).
const NOT_A_DECLINE = new Set([
  'UNAUTHORIZED_KEY',
  'FORBIDDEN_REQUEST',
  'IDEMPOTENT_REQUEST_PROCESSING',
  'TOO_MANY_REQUESTS',
  'PROVIDER_ERROR',
]);

interface TossPayment {
  paymentKey: string;
  orderId?: string;
  status: string;
  totalAmount: number;
  currency: string;
  method?: string | null;
  card?: { number?: string | null } | null;
  receipt?: { url?: string | null } | null;
}

interface TossError {
  code?: string;
  message?: string;
}

export interface TossConfig {
  secretKey: string | undefined;
  mode: PaymentsMode;
  fetch?: typeof globalThis.fetch;
}

function toResult(payment: TossPayment): PaymentResult {
  const status =
    payment.status === 'DONE'
      ? 'done'
      : payment.status === 'CANCELED' || payment.status === 'PARTIAL_CANCELED'
        ? 'canceled'
        : 'failed';
  // DR-4: Toss sends the card number masked; we keep only that.
  const methodSummary = [payment.method, payment.card?.number].filter(Boolean).join(' ');
  return {
    status,
    providerPaymentKey: payment.paymentKey,
    amount: payment.totalAmount,
    currency: payment.currency,
    ...(methodSummary ? { methodSummary } : {}),
    ...(payment.receipt?.url ? { receiptUrl: payment.receipt.url } : {}),
    ...(status === 'failed' ? { failureReason: payment.status } : {}),
    raw: payment,
  };
}

export function createTossProvider({
  secretKey,
  mode,
  fetch = globalThis.fetch,
}: TossConfig): PaymentProvider {
  // Test mode only ever talks to Toss with a test key; a live key there is a configuration
  // mistake, so nothing is sent (FR-42).
  const usable = Boolean(secretKey) && (mode !== 'test' || secretKey!.startsWith('test_'));
  const authorization = `Basic ${btoa(`${secretKey ?? ''}:`)}`;

  async function call(
    path: string,
    init: { method: 'GET' | 'DELETE' } | { method: 'POST'; body: unknown; idempotencyKey: string },
  ): Promise<{ ok: true; payment: TossPayment } | { ok: false; status: number; error: TossError }> {
    if (!usable) throw new ProviderError('toss', 'Toss is not configured for this payments mode.');
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method: init.method,
        headers: {
          authorization,
          ...(init.method === 'POST'
            ? { 'content-type': 'application/json', 'idempotency-key': init.idempotencyKey }
            : {}),
        },
        ...(init.method === 'POST' ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new ProviderError('toss', `Toss could not be reached for ${path}.`);
    }
    const body = (await res.json().catch(() => ({}))) as TossPayment & TossError;
    if (res.ok) return { ok: true, payment: body };
    if (res.status >= 500 || NOT_A_DECLINE.has(body.code ?? '') || res.status === 401) {
      throw new ProviderError('toss', `Toss answered ${res.status} ${body.code ?? ''}`.trim());
    }
    return { ok: false, status: res.status, error: body };
  }

  async function read(paymentKey: string): Promise<PaymentResult> {
    const answer = await call(`/v1/payments/${encodeURIComponent(paymentKey)}`, {
      method: 'GET',
    });
    if (!answer.ok) {
      throw new ProviderError('toss', `Toss answered ${answer.status} ${answer.error.code ?? ''}`);
    }
    return toResult(answer.payment);
  }

  return {
    id: 'toss',

    // FR-45: the authKey from Toss's card window becomes a billing key. The card comes back as
    // card.issuerCode and the masked card.number (cardCompany and cardNumber were removed in API
    // version 2024-06-01). Only the code and the last four characters are kept (DR-4).
    async issueBillingKey({ customerKey, authKey }) {
      const answer = await call('/v1/billing/authorizations/issue', {
        method: 'POST',
        body: { authKey, customerKey },
        idempotencyKey: `billing-issue-${authKey}`,
      });
      if (!answer.ok) {
        throw new PaymentRefused('toss', answer.error.code ?? `HTTP_${answer.status}`);
      }
      const billing = answer.payment as unknown as {
        billingKey: string;
        customerKey: string;
        card?: { issuerCode?: string; number?: string } | null;
      };
      return {
        billingKey: billing.billingKey,
        customerKey: billing.customerKey,
        ...(billing.card?.issuerCode ? { cardCompany: billing.card.issuerCode } : {}),
        ...(billing.card?.number ? { cardLast4: billing.card.number.slice(-4) } : {}),
      };
    },

    // FR-53: an empty 200. A key Toss no longer has is already gone.
    async deleteBillingKey(billingKey) {
      const answer = await call(`/v1/billing/${encodeURIComponent(billingKey)}`, {
        method: 'DELETE',
      });
      if (!answer.ok && answer.status !== 404) {
        throw new ProviderError(
          'toss',
          `Toss did not delete the billing key: ${answer.error.code}`,
        );
      }
    },

    async confirm({ order, providerPaymentKey, amount, currency }) {
      const answer = await call('/v1/payments/confirm', {
        method: 'POST',
        body: { paymentKey: providerPaymentKey, orderId: order.id, amount },
        idempotencyKey: `confirm-${providerPaymentKey}`,
      });
      if (answer.ok) return toResult(answer.payment);
      // Approved before (another request, or a retry after a lost answer): read it back (FR-38).
      if (answer.error.code === 'ALREADY_PROCESSED_PAYMENT') return read(providerPaymentKey);
      return {
        status: 'failed',
        providerPaymentKey,
        amount,
        currency,
        failureReason: answer.error.code ?? `HTTP_${answer.status}`,
        raw: answer.error,
      };
    },

    async cancel({ providerPaymentKey, reason }) {
      const answer = await call(`/v1/payments/${encodeURIComponent(providerPaymentKey)}/cancel`, {
        method: 'POST',
        body: { cancelReason: reason },
        idempotencyKey: `cancel-${providerPaymentKey}`,
      });
      if (!answer.ok) {
        throw new ProviderError('toss', `Toss refused the cancel: ${answer.error.code ?? ''}`);
      }
      return toResult(answer.payment);
    },

    // FR-48, FR-70: PAYMENT_STATUS_CHANGED is `{ eventType, createdAt, data: Payment }` and is not
    // signed, so the payment is read back from Toss and that answer is what counts. A payment Toss
    // does not know is not trusted; a lookup that cannot be made throws, so Toss sends it again.
    async verifyWebhook(req) {
      const body = (await req.json().catch(() => null)) as {
        eventType?: unknown;
        createdAt?: unknown;
        data?: { paymentKey?: unknown; status?: unknown } | null;
      } | null;
      if (body?.eventType !== 'PAYMENT_STATUS_CHANGED') return null;
      const paymentKey = body.data?.paymentKey;
      if (typeof paymentKey !== 'string' || paymentKey === '') return null;

      const answer = await call(`/v1/payments/${encodeURIComponent(paymentKey)}`, {
        method: 'GET',
      });
      if (!answer.ok) return null;
      const payment = toResult(answer.payment);
      return {
        eventId: `${paymentKey}:${String(body.data?.status ?? '')}:${String(body.createdAt ?? '')}`,
        eventType: body.eventType,
        providerPaymentKey: paymentKey,
        status: payment.status,
        orderRef: answer.payment.orderId ?? null,
        payment,
        raw: { body, payment: answer.payment },
      };
    },
  };
}
