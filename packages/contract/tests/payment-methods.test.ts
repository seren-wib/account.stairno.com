import { describe, expect, it } from 'vitest';
import { registerTossCardInputSchema } from '../src';

describe('Toss card registration input', () => {
  const valid = { authKey: 'bln_ow5zHP1mc0M', customerKey: 'cus_aBcD-1234_xyz' };

  it('FR-45 takes the authKey from Toss’s redirect and the customerKey', () => {
    expect(registerTossCardInputSchema.parse(valid)).toEqual(valid);
  });

  it('FR-45 refuses a customerKey outside Toss’s rule', () => {
    for (const customerKey of ['x', 'a'.repeat(51), 'has space', '한글키']) {
      expect(registerTossCardInputSchema.safeParse({ ...valid, customerKey }).success).toBe(false);
    }
  });

  it('FR-45 DR-4 needs an authKey and takes no card details', () => {
    expect(registerTossCardInputSchema.safeParse({ ...valid, authKey: '' }).success).toBe(false);
    expect(
      registerTossCardInputSchema.parse({ ...valid, cardNumber: '4330123412341234', cvc: '123' }),
    ).toEqual(valid);
  });
});
