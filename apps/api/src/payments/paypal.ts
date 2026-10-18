import { fromDecimalString, toDecimalString } from './money';
import type { PaymentsMode } from './mode';
import {
  ProviderError,
  type Checkout,
  type PaymentProvider,
  type PaymentResult,
  type WebhookEvent,
} from './provider';

// FR-49 to FR-52: PayPal behind PaymentProvider (NFR-13), USD only (DR-5). Shapes follow PayPal's
// OpenAPI schemas: Orders v2 (create, capture), Payments v2 (captures, refunds), Webhooks v1
// (verify-webhook-signature). OAuth client-credentials tokens; every POST has a PayPal-Request-Id
// so a retry gets PayPal's first answer. The sandbox unless the payments mode is live (FR-42).

const BASE_URL = { live: 'https://api-m.paypal.com', other: 'https://api-m.sandbox.paypal.com' };

// Capture refusals PayPal leaves for the payer to fix by approving at PayPal: not final.
const NOT_APPROVED = new Set(['ORDER_NOT_APPROVED', 'PAYER_ACTION_REQUIRED']);

const WEBHOOK_HEADERS = {
  auth_algo: 'paypal-auth-algo',
  cert_url: 'paypal-cert-url',
  transmission_id: 'paypal-transmission-id',
  transmission_sig: 'paypal-transmission-sig',
  transmission_time: 'paypal-transmission-time',
} as const;

interface PayPalCapture {
  id: string;
  status: string;
  amount?: { currency_code: string; value: string };
  custom_id?: string;
}

interface PayPalOrder {
  id: string;
  status: string;
  links?: { href: string; rel: string }[];
  purchase_units?: { payments?: { captures?: PayPalCapture[] } }[];
}

interface PayPalError {
  name?: string;
  details?: { issue?: string }[];
}

type Answer<T> = { ok: true; body: T } | { ok: false; status: number; issue: string };

export interface PayPalConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  webhookId: string | undefined;
  mode: PaymentsMode;
  fetch?: typeof globalThis.fetch;
}

function fromCapture(capture: PayPalCapture): PaymentResult {
  const currency = capture.amount?.currency_code ?? '';
  const amount = capture.amount ? fromDecimalString(capture.amount.value, currency) : 0;
  const base = { providerPaymentKey: capture.id, amount, currency, raw: capture };
  switch (capture.status) {
    case 'COMPLETED':
    // Only full refunds are ours to make (FR-51); a partial one leaves the purchase standing.
    case 'PARTIALLY_REFUNDED':
      return { ...base, status: 'done', methodSummary: 'PayPal' };
    case 'REFUNDED':
      return { ...base, status: 'canceled', methodSummary: 'PayPal' };
    case 'PENDING':
      return { ...base, status: 'pending', failureReason: 'PENDING' };
    default:
      return { ...base, status: 'failed', failureReason: capture.status };
  }
}

export function createPayPalProvider({
  clientId,
  clientSecret,
  webhookId,
  mode,
  fetch = globalThis.fetch,
}: PayPalConfig): PaymentProvider {
  const base = mode === 'live' ? BASE_URL.live : BASE_URL.other;
  let token: { value: string; until: number } | undefined;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch {
      throw new ProviderError(
        'paypal',
        `PayPal could not be reached for ${new URL(url).pathname}.`,
      );
    }
  }

  async function accessToken(): Promise<string> {
    if (!clientId || !clientSecret) {
      throw new ProviderError('paypal', 'PayPal is not configured.');
    }
    if (token && Date.now() < token.until) return token.value;
    const res = await send(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new ProviderError('paypal', `PayPal refused the token: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    // A minute early, so a token never runs out mid-request.
    token = { value: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  async function call<T>(
    path: string,
    init: { method: 'GET' } | { method: 'POST'; body: unknown; requestId: string },
  ): Promise<Answer<T>> {
    const res = await send(`${base}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        ...(init.method === 'POST'
          ? {
              'content-type': 'application/json',
              'paypal-request-id': init.requestId,
              prefer: 'return=representation',
            }
          : {}),
      },
      ...(init.method === 'POST' ? { body: JSON.stringify(init.body) } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as T & PayPalError;
    if (res.ok) return { ok: true, body };
    if (res.status === 401) token = undefined;
    const issue = body.details?.[0]?.issue ?? body.name ?? `HTTP_${res.status}`;
    // Ours or PayPal's trouble, not the payment's: 400 is a request PayPal calls invalid.
    if (res.status >= 500 || res.status === 400 || [401, 403, 429].includes(res.status)) {
      throw new ProviderError('paypal', `PayPal answered ${res.status} ${issue}`);
    }
    return { ok: false, status: res.status, issue };
  }

  function fromOrder(order: PayPalOrder, fallback: Omit<PaymentResult, 'status' | 'raw'>) {
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    if (capture) return fromCapture(capture);
    return { ...fallback, status: 'pending', failureReason: order.status, raw: order } as const;
  }

  return {
    id: 'paypal',

    async createCheckout({ order, returnUrl, cancelUrl }): Promise<Checkout> {
      const answer = await call<PayPalOrder>('/v2/checkout/orders', {
        method: 'POST',
        requestId: `create-${order.id}`,
        body: {
          intent: 'CAPTURE',
          purchase_units: [
            {
              custom_id: order.id,
              // PayPal refuses a second capture for the same invoice id: one more guard.
              invoice_id: order.id,
              amount: {
                currency_code: order.currency,
                value: toDecimalString(order.amount, order.currency),
              },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'Stairno',
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING',
                return_url: returnUrl,
                cancel_url: cancelUrl,
              },
            },
          },
        },
      });
      if (!answer.ok) {
        throw new ProviderError('paypal', `PayPal did not create the order: ${answer.issue}`);
      }
      const approval = answer.body.links?.find(
        (l) => l.rel === 'payer-action' || l.rel === 'approve',
      );
      if (!approval) throw new ProviderError('paypal', 'PayPal sent no approval link.');
      return { providerOrderId: answer.body.id, approvalUrl: approval.href };
    },

    async confirm({ providerPaymentKey: paypalOrderId, amount, currency }) {
      const path = `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`;
      const fallback = { providerPaymentKey: paypalOrderId, amount, currency };
      const answer = await call<PayPalOrder>(`${path}/capture`, {
        method: 'POST',
        requestId: `capture-${paypalOrderId}`,
        body: {},
      });
      if (answer.ok) return fromOrder(answer.body, fallback);
      if (answer.issue === 'ORDER_ALREADY_CAPTURED') {
        const order = await call<PayPalOrder>(path, { method: 'GET' });
        if (order.ok) return fromOrder(order.body, fallback);
      }
      if (NOT_APPROVED.has(answer.issue)) {
        return { ...fallback, status: 'pending', failureReason: answer.issue, raw: answer };
      }
      return { ...fallback, status: 'failed', failureReason: answer.issue, raw: answer };
    },

    // FR-51: the whole capture; the reason goes to the payer.
    async cancel({ providerPaymentKey: captureId, reason }) {
      const answer = await call<{
        status?: string;
        amount?: { currency_code: string; value: string };
      }>(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
        method: 'POST',
        requestId: `refund-${captureId}`,
        body: { note_to_payer: reason },
      });
      if (!answer.ok && answer.issue !== 'CAPTURE_FULLY_REFUNDED') {
        throw new ProviderError('paypal', `PayPal refused the refund: ${answer.issue}`);
      }
      const refunded = answer.ok ? answer.body.amount : undefined;
      return {
        status: 'canceled',
        providerPaymentKey: captureId,
        amount: refunded ? fromDecimalString(refunded.value, refunded.currency_code) : 0,
        currency: refunded?.currency_code ?? '',
        raw: answer.ok ? answer.body : answer,
      };
    },

    // FR-52, FR-70: PayPal signs its webhooks; PayPal itself checks the signature for us. Then
    // the capture is read back, so the state is PayPal's word now, not the event's.
    async verifyWebhook(req): Promise<WebhookEvent | null> {
      const signature: Record<string, string> = {};
      for (const [field, header] of Object.entries(WEBHOOK_HEADERS)) {
        const value = req.headers.get(header);
        if (!value) return null;
        signature[field] = value;
      }
      const event = (await req.json().catch(() => null)) as {
        id?: string;
        event_type?: string;
        resource_type?: string;
        resource?: { id?: string; links?: { href: string; rel: string }[] };
      } | null;
      if (!event?.id || !event.event_type?.startsWith('PAYMENT.CAPTURE.')) return null;
      if (!webhookId) throw new ProviderError('paypal', 'PAYPAL_WEBHOOK_ID is not set.');

      const verified = await call<{ verification_status?: string }>(
        '/v1/notifications/verify-webhook-signature',
        {
          method: 'POST',
          requestId: `verify-${event.id}-${signature.transmission_id}`,
          body: { ...signature, webhook_id: webhookId, webhook_event: event },
        },
      );
      if (!verified.ok || verified.body.verification_status !== 'SUCCESS') return null;

      // A capture event carries the capture; a refund event links up to it.
      const captureId =
        event.resource_type === 'refund'
          ? event.resource?.links
              ?.find((l) => l.rel === 'up')
              ?.href.split('/')
              .pop()
          : event.resource?.id;
      if (!captureId) return null;
      const capture = await call<PayPalCapture>(
        `/v2/payments/captures/${encodeURIComponent(captureId)}`,
        { method: 'GET' },
      );
      if (!capture.ok) return null;
      const payment = fromCapture(capture.body);
      return {
        eventId: event.id,
        eventType: event.event_type,
        providerPaymentKey: captureId,
        status: payment.status,
        orderRef: capture.body.custom_id ?? null,
        payment,
        raw: { event, capture: capture.body },
      };
    },
  };
}
