import { describe, expect, it } from 'vitest';
import { nextLocation, oauthQuery } from '../../src/lib/auth-form';

const API = 'https://api.stairno.com';

describe('oauthQuery', () => {
  it('FR-17 keeps the signed authorization query the provider attached', () => {
    const search = '?response_type=code&client_id=labs&state=s&exp=1&sig=abc';
    expect(oauthQuery(search)).toBe('response_type=code&client_id=labs&state=s&exp=1&sig=abc');
  });

  it('FR-17 sends nothing for a plain sign-in', () => {
    expect(oauthQuery('?redirect=%2Fko%2Fprofile')).toBeUndefined();
    expect(oauthQuery('')).toBeUndefined();
  });
});

describe('nextLocation', () => {
  it('FR-17 follows the URL the API answers with, on the API host', () => {
    expect(nextLocation({ url: '/auth/oauth2/authorize?x=1' }, API, '/ko/')).toBe(
      `${API}/auth/oauth2/authorize?x=1`,
    );
    expect(nextLocation({ url: 'https://stairnolabs.com/cb?code=1' }, API, '/ko/')).toBe(
      'https://stairnolabs.com/cb?code=1',
    );
  });

  it('FR-12 goes to the kept return address otherwise', () => {
    expect(nextLocation({ redirect: false }, API, '/en/devices')).toBe('/en/devices');
    expect(nextLocation(null, API, '/en/')).toBe('/en/');
  });
});
