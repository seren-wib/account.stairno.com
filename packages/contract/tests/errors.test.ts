import { describe, expect, it } from 'vitest';
import { errorCodes } from '../src';

describe('error codes', () => {
  it('FR-24 lists exactly the codes in SDD §8, without duplicates', () => {
    expect(errorCodes).toEqual([
      'unauthorized',
      'forbidden',
      'not_found',
      'conflict',
      'validation_failed',
      'rate_limited',
      'payments_off',
      'email_not_verified',
      'invalid_transition',
      'amount_mismatch',
      'provider_error',
      'internal_error',
    ]);
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
  });
});
