import { describe, expect, it } from 'vitest';
import { fromDecimalString, toDecimalString } from '../../src/payments/money';

// DR-9: amounts are whole minor units. PayPal speaks decimal strings, so the adapter converts at
// the edge, with integer arithmetic only.

describe('decimal strings for providers', () => {
  it.each([
    [900, 'USD', '9.00'],
    [5, 'USD', '0.05'],
    [123456, 'USD', '1234.56'],
    [0, 'USD', '0.00'],
    [12000, 'KRW', '12000'],
  ])('DR-9 writes %i %s as %s', (amount, currency, value) => {
    expect(toDecimalString(amount, currency)).toBe(value);
  });

  it.each([
    ['9.00', 'USD', 900],
    ['9', 'USD', 900],
    ['9.5', 'USD', 950],
    ['0.05', 'USD', 5],
    ['1234.56', 'USD', 123456],
    ['12000', 'KRW', 12000],
  ])('DR-9 reads %s %s as %i', (value, currency, amount) => {
    expect(fromDecimalString(value, currency)).toBe(amount);
  });

  it.each([
    ['9.001', 'USD'],
    ['-1.00', 'USD'],
    ['1e3', 'USD'],
    ['', 'USD'],
    ['12.5', 'KRW'],
  ])('DR-9 refuses %j in %s', (value, currency) => {
    expect(() => fromDecimalString(value, currency)).toThrow();
  });

  it('DR-9 refuses a currency it does not know rather than guess its decimals', () => {
    expect(() => toDecimalString(100, 'EUR')).toThrow();
  });
});
