import { describe, expect, it } from 'vitest';
import { confirmTossPaymentInputSchema, paypalOrderInputSchema } from '../src';

describe('PayPal order input', () => {
  it('FR-49 takes only our order id; the PayPal order id stays with the API', () => {
    const orderId = '6f1c2c47-0d1e-4c1b-9f0a-3b0b6a0f0c11';

    expect(paypalOrderInputSchema.parse({ orderId, paypalOrderId: 'SWAPPED' })).toEqual({
      orderId,
    });
    expect(paypalOrderInputSchema.safeParse({ orderId: 'order-1' }).success).toBe(false);
  });
});

const valid = {
  paymentKey: 'tgen_20261018_abc',
  orderId: '6f1c2c47-0d1e-4c1b-9f0a-3b0b6a0f0c11',
  amount: 12000,
};

function failedPaths(input: unknown) {
  const result = confirmTossPaymentInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('Toss confirm input', () => {
  it('FR-43 takes the payment key, our order id and the amount from the success redirect', () => {
    expect(confirmTossPaymentInputSchema.parse(valid)).toEqual(valid);
  });

  it('FR-43 DR-9 takes a positive whole amount only', () => {
    expect(failedPaths({ ...valid, amount: 12000.5 })).toEqual(['amount']);
    expect(failedPaths({ ...valid, amount: 0 })).toEqual(['amount']);
    expect(failedPaths({ ...valid, amount: '12000' })).toEqual(['amount']);
  });

  it('FR-43 needs an order id of ours and a payment key', () => {
    expect(failedPaths({ ...valid, orderId: 'order-1' })).toEqual(['orderId']);
    expect(failedPaths({ ...valid, paymentKey: '' })).toEqual(['paymentKey']);
    expect(failedPaths({ ...valid, paymentKey: 'x'.repeat(201) })).toEqual(['paymentKey']);
  });
});
