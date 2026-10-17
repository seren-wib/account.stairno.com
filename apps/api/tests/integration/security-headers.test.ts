import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';

describe('security headers', () => {
  it.each(['/health', '/v1/me', '/auth/jwks'])('NFR-7 are on %s', async (path) => {
    const { app } = await createTestApp();

    const res = await app.request(path);

    expect(res.headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});
