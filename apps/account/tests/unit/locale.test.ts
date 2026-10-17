import { describe, expect, it } from 'vitest';
import { pickLocale } from '../../src/lib/locale';

describe('pickLocale', () => {
  it('FR-75 prefers the signed-in user language', () => {
    expect(pickLocale('ko-KR,ko;q=0.9', 'en')).toBe('en');
  });

  it.each([
    ['en-US,en;q=0.9', 'en'],
    ['ko-KR,ko;q=0.9,en;q=0.8', 'ko'],
    ['fr-FR,fr;q=0.9,en;q=0.5', 'en'],
    ['ko;q=0.4,en;q=0.8', 'en'],
    ['fr', 'ko'],
    ['', 'ko'],
    [null, 'ko'],
  ])('FR-75 reads Accept-Language %s as %s', (header, expected) => {
    expect(pickLocale(header)).toBe(expected);
  });

  it('FR-75 ignores a stored language it does not know', () => {
    expect(pickLocale('en', 'fr')).toBe('en');
  });
});
