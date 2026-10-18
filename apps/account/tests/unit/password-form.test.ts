import { describe, expect, it } from 'vitest';
import { passwordChangeError, passwordChangeInput } from '../../src/lib/password-form';

describe('passwordChangeError', () => {
  it.each([
    [400, 'INVALID_PASSWORD', { field: 'currentPassword', key: 'current' }],
    [400, 'PASSWORD_COMPROMISED', { field: 'newPassword', key: 'passwordBreached' }],
    [400, 'PASSWORD_TOO_SHORT', { field: 'newPassword', key: 'passwordLength' }],
    [400, 'PASSWORD_TOO_LONG', { field: 'newPassword', key: 'passwordLength' }],
    [401, undefined, { field: 'form', key: 'unavailable' }],
    [429, undefined, { field: 'form', key: 'tooMany' }],
    [500, undefined, { field: 'form', key: 'unavailable' }],
  ])('FR-83 NFR-17 maps %s %s next to the right field', (status, code, expected) => {
    expect(passwordChangeError(status, code)).toEqual(expected);
  });
});

describe('passwordChangeInput', () => {
  it('FR-83 FR-1 asks for the current password and a new one of 8 to 128 characters', () => {
    expect(passwordChangeInput('', 'quiet-landing-9')).toEqual({
      currentPassword: 'currentMissing',
    });
    expect(passwordChangeInput('old-password-1', 'short')).toEqual({
      newPassword: 'passwordLength',
    });
    expect(passwordChangeInput('old-password-1', 'x'.repeat(129))).toEqual({
      newPassword: 'passwordLength',
    });
    expect(passwordChangeInput('old-password-1', 'quiet-landing-9')).toEqual({});
  });
});
