import type { APIContext, MiddlewareNext } from 'astro';

// NFR-7 (SDD §9). Astro's security.csp hashes the scripts and styles it emits. The API host is a
// runtime value, so the layout adds this directive while the page renders (Astro only accepts
// directives once rendering has started, not in middleware).
// A page may add its own sources, as /payment-methods does for Toss's SDK.
export function connectSrc(
  apiUrl: string | undefined,
  extra: string[] = [],
): `connect-src ${string}` {
  return `connect-src ${["'self'", ...(apiUrl ? [apiUrl] : []), ...extra].join(' ')}`;
}

// Headers a <meta> policy cannot carry, on every response.
export function createSecurityHeaders() {
  return async (_context: APIContext, next: MiddlewareNext) => {
    const res = await next();
    const headers = new Headers(res.headers);
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'DENY');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
