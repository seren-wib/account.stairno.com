import { describe, expect, it } from 'vitest';
import { signUpInputSchema, termsVersion } from '../src';

const valid = {
  name: 'Test User',
  email: 'user@example.com',
  password: 'stairs-and-lanterns-42',
  acceptTerms: true,
};

function errorPaths(input: unknown) {
  const result = signUpInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('sign-up input', () => {
  it('FR-1 accepts 8 and 128 characters and rejects 7 and 129', () => {
    expect(errorPaths({ ...valid, password: 'a'.repeat(8) })).toEqual([]);
    expect(errorPaths({ ...valid, password: 'a'.repeat(128) })).toEqual([]);
    expect(errorPaths({ ...valid, password: 'a'.repeat(7) })).toEqual(['password']);
    expect(errorPaths({ ...valid, password: 'a'.repeat(129) })).toEqual(['password']);
  });

  it('FR-1 FR-9 rejects a bad email, an empty name and unaccepted terms', () => {
    expect(errorPaths({ ...valid, email: 'not-an-email' })).toEqual(['email']);
    expect(errorPaths({ ...valid, name: '   ' })).toEqual(['name']);
    expect(errorPaths({ ...valid, acceptTerms: false })).toEqual(['acceptTerms']);
  });

  it('FR-9 names the terms version as a date', () => {
    expect(termsVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
