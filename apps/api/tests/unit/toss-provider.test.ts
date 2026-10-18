import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../src/payments/provider';
import { createTossProvider } from '../../src/payments/toss';

// The Toss adapter against a stubbed fetch: the requests it sends and how it reads the answers.
// No call leaves the test (NFR-16); real test-key calls are for the deployment rehearsal.

const SECRET = 'test_sk_unit_only_not_a_real_key';
const order = { id: '6f1c2c47-0d1e-4c1b-9f0a-3b0b6a0f0c11', amount: 12000, currency: 'KRW' };

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(...answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers.shift();
    if (!answer) throw new Error('no stubbed answer left');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const done = {
  paymentKey: 'tgen_20261018_abc',
  orderId: order.id,
  status: 'DONE',
  totalAmount: 12000,
  currency: 'KRW',
  method: '카드',
  card: { issuerCode: '4V', acquirerCode: '21', number: '43301234****123*' },
  receipt: { url: 'https://dashboard.tosspayments.com/receipt/abc' },
};

function confirm(toss: ReturnType<typeof createTossProvider>) {
  return toss.confirm({
    order,
    providerPaymentKey: 'tgen_20261018_abc',
    amount: 12000,
    currency: 'KRW',
  });
}

describe('Toss adapter', () => {
  it('FR-43 confirms with Basic auth on the secret key and an idempotency key', async () => {
    const { fetch, sent } = stub(json(200, done));
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    await confirm(toss);

    expect(sent).toEqual([
      {
        url: 'https://api.tosspayments.com/v1/payments/confirm',
        method: 'POST',
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from(`${SECRET}:`).toString('base64')}`,
          'content-type': 'application/json',
          'idempotency-key': 'confirm-tgen_20261018_abc',
        }),
        body: { paymentKey: 'tgen_20261018_abc', orderId: order.id, amount: 12000 },
      },
    ]);
  });

  it('FR-37 FR-43 DR-4 reads an approval: the approved amount, the masked card, the receipt', async () => {
    const { fetch } = stub(json(200, { ...done, totalAmount: 11000 }));
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    await expect(confirm(toss)).resolves.toEqual({
      status: 'done',
      providerPaymentKey: 'tgen_20261018_abc',
      amount: 11000,
      currency: 'KRW',
      methodSummary: '카드 43301234****123*',
      receiptUrl: 'https://dashboard.tosspayments.com/receipt/abc',
      raw: { ...done, totalAmount: 11000 },
    });
  });

  // Toss's error table for confirm: card declines are 403 (REJECT_CARD_PAYMENT,
  // REJECT_CARD_COMPANY) or 400 (INVALID_REJECT_CARD, INVALID_CARD_EXPIRATION), so the code decides,
  // not the status.
  it.each([
    [403, 'REJECT_CARD_PAYMENT'],
    [403, 'REJECT_CARD_COMPANY'],
    [400, 'INVALID_REJECT_CARD'],
    [400, 'INVALID_CARD_EXPIRATION'],
    [404, 'NOT_FOUND_PAYMENT_SESSION'],
  ])('FR-43 reads a %i %s as a failed payment with the Toss code', async (status, code) => {
    const { fetch } = stub(json(status, { code, message: '거절' }));
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    await expect(confirm(toss)).resolves.toMatchObject({
      status: 'failed',
      providerPaymentKey: 'tgen_20261018_abc',
      amount: 12000,
      currency: 'KRW',
      failureReason: code,
    });
  });

  it('FR-38 reads back a payment Toss already approved', async () => {
    const { fetch, sent } = stub(
      json(400, { code: 'ALREADY_PROCESSED_PAYMENT', message: '이미 처리된 결제' }),
      json(200, done),
    );
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    await expect(confirm(toss)).resolves.toMatchObject({ status: 'done', amount: 12000 });
    expect(sent[1]).toMatchObject({
      url: 'https://api.tosspayments.com/v1/payments/tgen_20261018_abc',
      method: 'GET',
    });
  });

  it.each([
    ['a rejected key', json(401, { code: 'UNAUTHORIZED_KEY', message: 'unauthorized' })],
    ['a forbidden request', json(403, { code: 'FORBIDDEN_REQUEST', message: 'forbidden' })],
    [
      'a duplicate still processing',
      json(409, { code: 'IDEMPOTENT_REQUEST_PROCESSING', message: 'processing' }),
    ],
    ['too many requests', json(429, { code: 'TOO_MANY_REQUESTS', message: 'slow down' })],
    ['a passing fault at Toss', json(400, { code: 'PROVIDER_ERROR', message: '일시적인 오류' })],
    ['a server error', json(500, { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING', message: 'oops' })],
    ['a network failure', new TypeError('fetch failed')],
  ])('FR-43 treats %s as the provider failing, not as a decline', async (_, answer) => {
    const { fetch } = stub(answer);
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    const error = await confirm(toss).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it('FR-37 FR-47 cancels the whole payment with a reason and an idempotency key', async () => {
    const { fetch, sent } = stub(json(200, { ...done, status: 'CANCELED' }));
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    await expect(
      toss.cancel({ providerPaymentKey: 'tgen_20261018_abc', reason: 'amount mismatch' }),
    ).resolves.toMatchObject({ status: 'canceled', providerPaymentKey: 'tgen_20261018_abc' });
    expect(sent[0]).toMatchObject({
      url: 'https://api.tosspayments.com/v1/payments/tgen_20261018_abc/cancel',
      method: 'POST',
      headers: expect.objectContaining({ 'idempotency-key': 'cancel-tgen_20261018_abc' }),
      body: { cancelReason: 'amount mismatch' },
    });
  });

  it.each([
    ['a live key in test mode', 'live_sk_should_never_be_here', 'test'],
    ['no key', undefined, 'test'],
  ] as const)('FR-42 refuses to call Toss with %s', async (_, secretKey, mode) => {
    const { fetch, sent } = stub();
    const toss = createTossProvider({ secretKey, mode, fetch });

    await expect(confirm(toss)).rejects.toBeInstanceOf(ProviderError);
    expect(sent).toEqual([]);
  });
});

// Toss's PAYMENT_STATUS_CHANGED carries no signature (only payout and seller events are signed),
// so the adapter believes the payment it reads back from Toss, not the body (FR-70).
describe('Toss webhook check', () => {
  const createdAt = '2026-10-18T10:00:00.000000';

  function webhook(body: unknown) {
    return new Request('https://api.stairno.com/webhooks/toss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  const statusChanged = {
    eventType: 'PAYMENT_STATUS_CHANGED',
    createdAt,
    data: { ...done, status: 'DONE' },
  };

  it('FR-48 FR-70 reads the payment back and takes its state from Toss, not the body', async () => {
    const { fetch, sent } = stub(json(200, { ...done, status: 'CANCELED' }));
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    const event = await toss.verifyWebhook(webhook(statusChanged));

    expect(sent).toEqual([
      expect.objectContaining({
        url: 'https://api.tosspayments.com/v1/payments/tgen_20261018_abc',
        method: 'GET',
      }),
    ]);
    expect(event).toMatchObject({
      eventId: `tgen_20261018_abc:DONE:${createdAt}`,
      eventType: 'PAYMENT_STATUS_CHANGED',
      providerPaymentKey: 'tgen_20261018_abc',
      status: 'canceled',
      orderRef: order.id,
      payment: { status: 'canceled', amount: 12000, currency: 'KRW' },
    });
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['another event type', { ...statusChanged, eventType: 'payout.changed' }],
    ['no payment key', { ...statusChanged, data: { status: 'DONE' } }],
  ])('FR-70 does not trust %s and asks Toss nothing', async (_, body) => {
    const { fetch, sent } = stub();
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    await expect(toss.verifyWebhook(webhook(body))).resolves.toBeNull();
    expect(sent).toEqual([]);
  });

  it('FR-70 does not trust a payment Toss does not know', async () => {
    const { fetch } = stub(json(404, { code: 'NOT_FOUND_PAYMENT', message: '없음' }));
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    await expect(toss.verifyWebhook(webhook(statusChanged))).resolves.toBeNull();
  });

  it('FR-69 fails like the provider when the lookup cannot be made, so Toss sends it again', async () => {
    const { fetch } = stub(json(500, { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING', message: '' }));
    const toss = createTossProvider({ secretKey: SECRET, mode: 'test', fetch });

    await expect(toss.verifyWebhook(webhook(statusChanged))).rejects.toBeInstanceOf(ProviderError);
  });
});
