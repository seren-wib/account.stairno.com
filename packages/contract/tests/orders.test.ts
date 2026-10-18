import { describe, expect, it } from 'vitest';
import { createOrderInputSchema } from '../src';

const valid = {
  sku: 'atlas-odyssey-desktop',
  currency: 'KRW',
  returnUrl: 'https://stairnolabs.com/checkout/done',
};

function failedPaths(input: unknown) {
  const result = createOrderInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('create order input', () => {
  it('FR-35 takes a sku, a currency and the page to return to', () => {
    expect(createOrderInputSchema.parse(valid)).toEqual(valid);
  });

  it('FR-35 drops a user id sent in the body', () => {
    expect(createOrderInputSchema.parse({ ...valid, userId: 'someone-else' })).toEqual(valid);
  });

  it('FR-35 DR-5 takes KRW and USD only', () => {
    expect(failedPaths({ ...valid, currency: 'EUR' })).toEqual(['currency']);
    expect(failedPaths({ ...valid, currency: 'USD' })).toEqual([]);
  });

  it('FR-35 needs an https return address', () => {
    expect(failedPaths({ ...valid, returnUrl: 'http://stairnolabs.com/done' })).toEqual([
      'returnUrl',
    ]);
    expect(failedPaths({ ...valid, returnUrl: 'not a url' })).toEqual(['returnUrl']);
  });

  it('FR-35 needs every field', () => {
    expect(failedPaths({}).sort()).toEqual(['currency', 'returnUrl', 'sku']);
  });
});
