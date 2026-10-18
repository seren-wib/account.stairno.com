import { describe, expect, it } from 'vitest';
import { createPayPalProvider } from '../../src/payments/paypal';
import { ProviderError } from '../../src/payments/provider';

// The PayPal adapter against a stubbed fetch (NFR-16). Request and response shapes follow PayPal's
// OpenAPI schemas for Orders v2, Payments v2 and Webhooks v1.

const SANDBOX = 'https://api-m.sandbox.paypal.com';
const config = {
  clientId: 'sandbox-client-id',
  clientSecret: 'sandbox-client-secret-unit-only',
  webhookId: 'WH-UNIT-1',
  mode: 'test' as const,
};
const order = { id: '6f1c2c47-0d1e-4c1b-9f0a-3b0b6a0f0c11', amount: 900, currency: 'USD' };
const PAYPAL_ORDER = '5O190127TN364715T';
const CAPTURE = '3C679366HH908993F';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const token = () =>
  json(200, { access_token: 'A21AA-token', token_type: 'Bearer', expires_in: 32400 });

function stub(...answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body ? String(init.body) : undefined;
    let body: unknown = raw;
    try {
      body = raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      // form bodies stay strings
    }
    sent.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    });
    const answer = answers.shift();
    if (!answer) throw new Error('no stubbed answer left');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
}

const capture = (status = 'COMPLETED', value = '9.00') => ({
  id: CAPTURE,
  status,
  amount: { currency_code: 'USD', value },
  custom_id: order.id,
  invoice_id: order.id,
});

const captured = (c = capture()) => ({
  id: PAYPAL_ORDER,
  status: 'COMPLETED',
  purchase_units: [{ reference_id: 'default', payments: { captures: [c] } }],
});

function confirm(paypal: ReturnType<typeof createPayPalProvider>) {
  return paypal.confirm({ order, providerPaymentKey: PAYPAL_ORDER, amount: 900, currency: 'USD' });
}

describe('PayPal adapter', () => {
  it('FR-49 creates an order: OAuth token first, then the order with our id and the return URLs', async () => {
    const { fetch, sent } = stub(
      token(),
      json(200, {
        id: PAYPAL_ORDER,
        status: 'PAYER_ACTION_REQUIRED',
        links: [
          { href: `${SANDBOX}/v2/checkout/orders/${PAYPAL_ORDER}`, rel: 'self', method: 'GET' },
          {
            href: `https://www.sandbox.paypal.com/checkoutnow?token=${PAYPAL_ORDER}`,
            rel: 'payer-action',
            method: 'GET',
          },
        ],
      }),
    );
    const paypal = createPayPalProvider({ ...config, fetch });

    const checkout = await paypal.createCheckout!({
      order,
      returnUrl: 'https://stairnolabs.com/checkout/done',
      cancelUrl: 'https://stairnolabs.com/checkout/done',
    });

    expect(checkout).toEqual({
      providerOrderId: PAYPAL_ORDER,
      approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${PAYPAL_ORDER}`,
    });
    expect(sent[0]).toMatchObject({
      url: `${SANDBOX}/v1/oauth2/token`,
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    expect(sent[1]).toMatchObject({
      url: `${SANDBOX}/v2/checkout/orders`,
      method: 'POST',
      headers: {
        authorization: 'Bearer A21AA-token',
        'paypal-request-id': `create-${order.id}`,
      },
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: order.id,
            invoice_id: order.id,
            amount: { currency_code: 'USD', value: '9.00' },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Stairno',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: 'https://stairnolabs.com/checkout/done',
              cancel_url: 'https://stairnolabs.com/checkout/done',
            },
          },
        },
      },
    });
  });

  it('FR-49 keeps the access token until it runs out', async () => {
    const { fetch, sent } = stub(token(), json(201, captured()), json(201, captured()));
    const paypal = createPayPalProvider({ ...config, fetch });

    await confirm(paypal);
    await confirm(paypal);

    expect(sent.filter((s) => s.url.endsWith('/v1/oauth2/token'))).toHaveLength(1);
  });

  it('FR-49 FR-50 captures and reads the capture: its id is the payment key, the amount in cents', async () => {
    const { fetch, sent } = stub(token(), json(201, captured(capture('COMPLETED', '8.00'))));
    const paypal = createPayPalProvider({ ...config, fetch });

    await expect(confirm(paypal)).resolves.toEqual({
      status: 'done',
      providerPaymentKey: CAPTURE,
      amount: 800,
      currency: 'USD',
      methodSummary: 'PayPal',
      raw: capture('COMPLETED', '8.00'),
    });
    expect(sent[1]).toMatchObject({
      url: `${SANDBOX}/v2/checkout/orders/${PAYPAL_ORDER}/capture`,
      method: 'POST',
      headers: { 'paypal-request-id': `capture-${PAYPAL_ORDER}` },
    });
  });

  it.each([
    ['a declined capture', json(201, captured(capture('DECLINED'))), 'DECLINED'],
    [
      'a declined instrument',
      json(422, {
        name: 'UNPROCESSABLE_ENTITY',
        message: 'x',
        debug_id: 'd',
        details: [{ issue: 'INSTRUMENT_DECLINED' }],
      }),
      'INSTRUMENT_DECLINED',
    ],
    [
      'an order PayPal does not know',
      json(404, {
        name: 'RESOURCE_NOT_FOUND',
        message: 'x',
        debug_id: 'd',
        details: [{ issue: 'INVALID_RESOURCE_ID' }],
      }),
      'INVALID_RESOURCE_ID',
    ],
  ])('FR-49 reads %s as a failed payment', async (_, answer, reason) => {
    const { fetch } = stub(token(), answer);
    const paypal = createPayPalProvider({ ...config, fetch });

    await expect(confirm(paypal)).resolves.toMatchObject({
      status: 'failed',
      failureReason: reason,
    });
  });

  it.each([
    [
      'a payer who has not approved yet',
      json(422, {
        name: 'UNPROCESSABLE_ENTITY',
        message: 'x',
        debug_id: 'd',
        details: [{ issue: 'ORDER_NOT_APPROVED' }],
      }),
    ],
    ['a capture still pending at PayPal', json(201, captured(capture('PENDING')))],
  ])('FR-49 reads %s as not finished', async (_, answer) => {
    const { fetch } = stub(token(), answer);
    const paypal = createPayPalProvider({ ...config, fetch });

    await expect(confirm(paypal)).resolves.toMatchObject({ status: 'pending' });
  });

  it('FR-38 reads back an order PayPal already captured', async () => {
    const { fetch, sent } = stub(
      token(),
      json(422, {
        name: 'UNPROCESSABLE_ENTITY',
        message: 'x',
        debug_id: 'd',
        details: [{ issue: 'ORDER_ALREADY_CAPTURED' }],
      }),
      json(200, captured()),
    );
    const paypal = createPayPalProvider({ ...config, fetch });

    await expect(confirm(paypal)).resolves.toMatchObject({
      status: 'done',
      providerPaymentKey: CAPTURE,
    });
    expect(sent[2]).toMatchObject({
      url: `${SANDBOX}/v2/checkout/orders/${PAYPAL_ORDER}`,
      method: 'GET',
    });
  });

  it.each([
    ['a rejected token', json(401, { error: 'invalid_client' })],
    ['too many requests', json(429, { name: 'RATE_LIMIT_REACHED', message: 'x', debug_id: 'd' })],
    ['a server error', json(500, { name: 'INTERNAL_SERVER_ERROR', message: 'x', debug_id: 'd' })],
    [
      'a request PayPal calls invalid',
      json(400, {
        name: 'INVALID_REQUEST',
        message: 'x',
        debug_id: 'd',
        details: [{ issue: 'MISSING_REQUIRED_PARAMETER' }],
      }),
    ],
    ['a network failure', new TypeError('fetch failed')],
  ])('FR-49 treats %s as the provider failing', async (_, answer) => {
    const { fetch } = stub(token(), answer);
    const paypal = createPayPalProvider({ ...config, fetch });

    const error = await confirm(paypal).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(String((error as Error).message)).not.toContain(config.clientSecret);
  });

  it('FR-51 refunds the whole capture', async () => {
    const { fetch, sent } = stub(token(), json(201, { id: 'REFUND1', status: 'COMPLETED' }));
    const paypal = createPayPalProvider({ ...config, fetch });

    await expect(
      paypal.cancel({ providerPaymentKey: CAPTURE, reason: 'Amount differs from the order.' }),
    ).resolves.toMatchObject({ status: 'canceled', providerPaymentKey: CAPTURE });
    expect(sent[1]).toMatchObject({
      url: `${SANDBOX}/v2/payments/captures/${CAPTURE}/refund`,
      method: 'POST',
      headers: { 'paypal-request-id': `refund-${CAPTURE}` },
      body: { note_to_payer: 'Amount differs from the order.' },
    });
  });

  it('FR-42 uses the live API only in live mode and never without credentials', async () => {
    const live = stub(token(), json(201, captured()));
    await confirm(createPayPalProvider({ ...config, mode: 'live', fetch: live.fetch }));
    expect(live.sent[0]?.url).toBe('https://api-m.paypal.com/v1/oauth2/token');

    const none = stub();
    await expect(
      confirm(createPayPalProvider({ ...config, clientSecret: undefined, fetch: none.fetch })),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(none.sent).toEqual([]);
  });
});

describe('PayPal webhook check', () => {
  const headers = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
    'paypal-transmission-id': 'tx-1',
    'paypal-transmission-sig': 'sig-1',
    'paypal-transmission-time': '2026-10-18T10:00:00Z',
  };
  const completed = {
    id: 'WH-EVENT-1',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource_type: 'capture',
    resource: capture(),
  };

  function webhook(body: unknown, h: Record<string, string> = headers) {
    return new Request('https://api.stairno.com/webhooks/paypal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...h },
      body: JSON.stringify(body),
    });
  }

  it('FR-52 FR-70 verifies the signature with PayPal, then reads the capture back', async () => {
    const { fetch, sent } = stub(
      token(),
      json(200, { verification_status: 'SUCCESS' }),
      json(200, capture('REFUNDED')),
    );
    const paypal = createPayPalProvider({ ...config, fetch });

    const event = await paypal.verifyWebhook(webhook(completed));

    expect(sent[1]).toMatchObject({
      url: `${SANDBOX}/v1/notifications/verify-webhook-signature`,
      method: 'POST',
      body: {
        auth_algo: 'SHA256withRSA',
        cert_url: headers['paypal-cert-url'],
        transmission_id: 'tx-1',
        transmission_sig: 'sig-1',
        transmission_time: '2026-10-18T10:00:00Z',
        webhook_id: 'WH-UNIT-1',
        webhook_event: completed,
      },
    });
    expect(sent[2]).toMatchObject({
      url: `${SANDBOX}/v2/payments/captures/${CAPTURE}`,
      method: 'GET',
    });
    expect(event).toMatchObject({
      eventId: 'WH-EVENT-1',
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      providerPaymentKey: CAPTURE,
      status: 'canceled',
      orderRef: order.id,
      payment: { status: 'canceled', amount: 900, currency: 'USD' },
    });
  });

  it('FR-51 FR-52 finds the capture of a refund through its up link', async () => {
    const { fetch, sent } = stub(
      token(),
      json(200, { verification_status: 'SUCCESS' }),
      json(200, capture('REFUNDED')),
    );
    const paypal = createPayPalProvider({ ...config, fetch });

    const event = await paypal.verifyWebhook(
      webhook({
        id: 'WH-EVENT-2',
        event_type: 'PAYMENT.CAPTURE.REFUNDED',
        resource_type: 'refund',
        resource: {
          id: 'REFUND1',
          status: 'COMPLETED',
          links: [
            { href: `${SANDBOX}/v2/payments/refunds/REFUND1`, rel: 'self', method: 'GET' },
            { href: `${SANDBOX}/v2/payments/captures/${CAPTURE}`, rel: 'up', method: 'GET' },
          ],
        },
      }),
    );

    expect(sent[2]?.url).toBe(`${SANDBOX}/v2/payments/captures/${CAPTURE}`);
    expect(event).toMatchObject({
      providerPaymentKey: CAPTURE,
      status: 'canceled',
      orderRef: order.id,
    });
  });

  it('FR-52 does not trust a signature PayPal does not confirm', async () => {
    const { fetch } = stub(token(), json(200, { verification_status: 'FAILURE' }));
    const paypal = createPayPalProvider({ ...config, fetch });

    await expect(paypal.verifyWebhook(webhook(completed))).resolves.toBeNull();
  });

  it.each([
    ['no PayPal headers', completed, {}],
    ['another kind of event', { ...completed, event_type: 'CHECKOUT.ORDER.APPROVED' }, headers],
  ])('FR-52 does not trust %s and asks PayPal nothing', async (_, body, h) => {
    const { fetch, sent } = stub();
    const paypal = createPayPalProvider({ ...config, fetch });

    await expect(paypal.verifyWebhook(webhook(body, h))).resolves.toBeNull();
    expect(sent).toEqual([]);
  });
});
