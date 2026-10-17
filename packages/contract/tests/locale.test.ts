import { describe, expect, it } from 'vitest';
import { localeSchema, locales } from '../src';

describe('locales', () => {
  it('FR-78 the account center and the mails speak exactly ko and en', () => {
    expect(locales).toEqual(['ko', 'en']);
  });

  it('FR-78 the locale schema rejects anything else', () => {
    expect(localeSchema.safeParse('en').success).toBe(true);
    expect(localeSchema.safeParse('fr').success).toBe(false);
    expect(localeSchema.safeParse('').success).toBe(false);
  });
});
