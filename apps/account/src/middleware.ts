import { env } from 'cloudflare:workers';
import { defineMiddleware, sequence } from 'astro:middleware';
import { createSecurityHeaders } from './lib/security-headers';
import { createSessionGuard } from './lib/session-guard';

const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);

export const onRequest = sequence(
  defineMiddleware((context, next) => createSecurityHeaders()(context, next)),
  defineMiddleware((context, next) =>
    createSessionGuard({ apiUrl: env.PUBLIC_API_URL, fetch: fetchFn })(context, next),
  ),
);
