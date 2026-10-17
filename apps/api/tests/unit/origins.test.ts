import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, originsOf } from '../../src/lib/origins';

const allowed = ['https://account.stairno.com', 'https://stairnolabs.com'];

describe('isAllowedOrigin', () => {
  it.each([
    ['https://account.stairno.com', true],
    ['https://stairnolabs.com', true],
    ['http://account.stairno.com', false],
    ['https://stairnolabs.com.evil.example', false],
    ['https://evil.example', false],
    ['https://account.stairno.com:8443', false],
    ['null', false],
    ['', false],
  ])('FR-26 %s → %s', (origin, expected) => {
    expect(isAllowedOrigin(origin, allowed)).toBe(expected);
  });
});

describe('originsOf', () => {
  it('FR-26 takes the origins of redirect URIs, once each, skipping bad ones', () => {
    expect(
      originsOf([
        'https://stairnolabs.com/api/auth/oauth2/callback/stairno',
        'https://stairnolabs.com/other',
        'https://stairnoworks.com/cb',
        'not a url',
      ]).sort(),
    ).toEqual(['https://stairnolabs.com', 'https://stairnoworks.com']);
  });
});
