import { describe, expect, it } from 'vitest';
import { apiErrorField, clientErrors } from '../../src/lib/sign-up-form';
import { resumeAuthorizeUrl } from '../../src/lib/auth-form';

describe('clientErrors', () => {
  it('NFR-17 FR-1 FR-9 names the field of each problem once', () => {
    expect(
      clientErrors({ name: ' ', email: 'nope', password: 'short', acceptTerms: false }),
    ).toEqual({
      name: 'name',
      email: 'email',
      password: 'passwordLength',
      acceptTerms: 'terms',
    });
  });

  it('NFR-17 has nothing to say about valid input', () => {
    expect(
      clientErrors({
        name: 'Yu',
        email: 'yu@example.com',
        password: 'stairs-and-lanterns',
        acceptTerms: true,
      }),
    ).toEqual({});
  });
});

describe('apiErrorField', () => {
  it.each([
    [400, 'PASSWORD_COMPROMISED', { field: 'password', key: 'passwordBreached' }],
    [400, 'PASSWORD_TOO_SHORT', { field: 'password', key: 'passwordLength' }],
    [422, 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', { field: 'email', key: 'emailTaken' }],
    [429, undefined, { field: 'form', key: 'tooMany' }],
    [500, undefined, { field: 'form', key: 'unavailable' }],
  ])('NFR-17 maps %s %s to a field', (status, code, expected) => {
    expect(apiErrorField(status, code)).toEqual(expected);
  });
});

describe('resumeAuthorizeUrl', () => {
  it('FR-17 sends a new user back into the site authorization without the signature', () => {
    const url = new URL(
      resumeAuthorizeUrl(
        'response_type=code&client_id=labs&state=s&exp=1792000000&sig=abc',
        'https://api.stairno.com',
      ),
    );
    expect(url.origin + url.pathname).toBe('https://api.stairno.com/auth/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('labs');
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.searchParams.has('sig')).toBe(false);
    expect(url.searchParams.has('exp')).toBe(false);
  });
});
