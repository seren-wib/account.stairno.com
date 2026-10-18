import { describe, expect, it, vi } from 'vitest';
import { createFakeProvider } from '../../src/payments/fake';
import { ProviderError, type PaymentProvider } from '../../src/payments/provider';

// The fake stands in for Toss and PayPal in every payment test (NFR-16). These cases pin the
// behaviours the later route tests will script: approve, decline, a different amount, a slow or
// failing provider, billing keys and webhooks (test-deploy §6).

const order = {
  id: '6f1c2c47-0d1e-4c1b-9f0a-3b0b6a0f0c11',
  amount: 12000,
  currency: 'KRW',
};

function confirm(provider: PaymentProvider, key = 'fake_pay_1', amount = order.amount) {
  return provider.confirm({ order, providerPaymentKey: key, amount, currency: order.currency });
}

describe('fake payment provider', () => {
  it('NFR-16 approves at the amount and currency it was asked for by default', async () => {
    const fake = createFakeProvider();

    await expect(confirm(fake)).resolves.toMatchObject({
      status: 'done',
      providerPaymentKey: 'fake_pay_1',
      amount: 12000,
      currency: 'KRW',
    });
    expect(fake.id).toBe('fake');
  });

  it('NFR-16 declines when told to, with the reason', async () => {
    const fake = createFakeProvider();
    fake.willDecline('card declined');

    await expect(confirm(fake)).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'card declined',
    });
    await expect(confirm(fake, 'fake_pay_2')).resolves.toMatchObject({ status: 'done' });
  });

  it('FR-37 can approve a different amount than the order, as a tampered payment would', async () => {
    const fake = createFakeProvider();
    fake.willApproveAmount(1000);

    await expect(confirm(fake)).resolves.toMatchObject({ status: 'done', amount: 1000 });
  });

  it('NFR-16 plays scripted answers in the order they were given', async () => {
    const fake = createFakeProvider();
    fake.willApproveAmount(1000);
    fake.willThrow();

    await expect(confirm(fake)).resolves.toMatchObject({ status: 'done', amount: 1000 });
    await expect(
      fake.cancel({ providerPaymentKey: 'fake_pay_1', reason: 'amount mismatch' }),
    ).rejects.toBeInstanceOf(ProviderError);
    await expect(confirm(fake, 'fake_pay_2')).resolves.toMatchObject({ amount: 12000 });
  });

  it('NFR-16 can fail like an unreachable provider', async () => {
    const fake = createFakeProvider();
    fake.willThrow();

    await expect(confirm(fake)).rejects.toBeInstanceOf(ProviderError);
  });

  it('NFR-16 can answer slowly', async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeProvider({ delayMs: 5_000 });
      let settled = false;
      const pending = confirm(fake).then(() => (settled = true));

      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('FR-38 answers a second confirm of the same payment key with the first result', async () => {
    const fake = createFakeProvider();
    const first = await confirm(fake);
    fake.willDecline('should not apply');

    await expect(confirm(fake)).resolves.toEqual(first);
  });

  it('FR-47 cancels a payment it approved', async () => {
    const fake = createFakeProvider();
    await confirm(fake);

    await expect(
      fake.cancel({ providerPaymentKey: 'fake_pay_1', reason: 'refund requested' }),
    ).resolves.toMatchObject({ status: 'canceled', providerPaymentKey: 'fake_pay_1' });
  });

  it('FR-45 FR-46 FR-53 issues, charges and deletes billing keys', async () => {
    const fake = createFakeProvider();

    const key = await fake.issueBillingKey!({
      customerKey: 'cust_1',
      authKey: 'auth_1',
    });
    expect(key).toMatchObject({
      customerKey: 'cust_1',
      cardLast4: expect.stringMatching(/^\d{4}$/),
    });

    await expect(
      fake.chargeBillingKey!({ billingKey: key.billingKey, customerKey: 'cust_1', order }),
    ).resolves.toMatchObject({ status: 'done', amount: 12000 });

    await fake.deleteBillingKey!(key.billingKey);
    await expect(
      fake.chargeBillingKey!({ billingKey: key.billingKey, customerKey: 'cust_1', order }),
    ).resolves.toMatchObject({ status: 'failed' });
  });

  it('FR-70 trusts a webhook only with a valid signature', async () => {
    const fake = createFakeProvider();
    const event = {
      eventId: 'evt_1',
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      providerPaymentKey: 'fake_pay_1',
      status: 'done' as const,
    };

    await expect(fake.verifyWebhook(fake.webhookRequest(event))).resolves.toMatchObject(event);
    await expect(
      fake.verifyWebhook(fake.webhookRequest(event, { signature: 'forged' })),
    ).resolves.toBeNull();
  });

  it('NFR-16 records every call so tests can assert what the API asked for', async () => {
    const fake = createFakeProvider();
    await confirm(fake);
    await fake.cancel({ providerPaymentKey: 'fake_pay_1', reason: 'refund requested' });

    expect(fake.calls.map((call) => call.method)).toEqual(['confirm', 'cancel']);
    expect(fake.calls[0]).toMatchObject({ input: { providerPaymentKey: 'fake_pay_1' } });
  });
});
