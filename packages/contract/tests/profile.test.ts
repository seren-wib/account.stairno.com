import { describe, expect, it } from 'vitest';
import { profileUpdateSchema } from '../src';

describe('profile update input', () => {
  it('FR-6 keeps only name and locale', () => {
    const parsed = profileUpdateSchema.parse({
      name: '  Yu  ',
      locale: 'en',
      email: 'other@example.com',
      emailVerified: true,
    });
    expect(parsed).toEqual({ name: 'Yu', locale: 'en' });
  });

  it('FR-6 FR-78 accepts only ko and en', () => {
    expect(profileUpdateSchema.safeParse({ name: 'Yu', locale: 'fr' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ name: 'Yu', locale: 'ko' }).success).toBe(true);
  });

  it('FR-6 refuses an empty name', () => {
    const result = profileUpdateSchema.safeParse({ name: '   ', locale: 'ko' });
    expect(result.success ? [] : result.error.issues.map((i) => i.path.join('.'))).toEqual([
      'name',
    ]);
  });
});
