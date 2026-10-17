import type { APIContext } from 'astro';
import { describe, expect, it, vi } from 'vitest';
import { connectSrc, createSecurityHeaders } from '../../src/lib/security-headers';

describe('security headers', () => {
  it('NFR-7 lets pages call only the API besides their own origin', () => {
    expect(connectSrc('https://api.stairno.com')).toBe(
      "connect-src 'self' https://api.stairno.com",
    );
    expect(connectSrc(undefined)).toBe("connect-src 'self'");
  });

  it('NFR-7 sends HSTS, nosniff, the referrer policy and no framing', async () => {
    const next = vi.fn(async () => new Response('<html></html>', { status: 200 }));
    const res = await createSecurityHeaders()({} as APIContext, next);
    expect(res.headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});
