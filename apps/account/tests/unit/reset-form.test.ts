import { describe, expect, it } from 'vitest';
import { resetError } from '../../src/lib/reset-form';

describe('resetError', () => {
  it.each([
    [400, 'INVALID_TOKEN', 'expired'],
    [400, 'TOKEN_EXPIRED', 'expired'],
    [400, 'PASSWORD_COMPROMISED', 'passwordBreached'],
    [400, 'PASSWORD_TOO_SHORT', 'passwordLength'],
    [400, 'PASSWORD_TOO_LONG', 'passwordLength'],
    [429, undefined, 'tooMany'],
    [500, undefined, 'unavailable'],
  ])('FR-5 NFR-17 maps %s %s to %s', (status, code, key) => {
    expect(resetError(status, code)).toBe(key);
  });
});
