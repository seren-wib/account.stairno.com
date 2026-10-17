import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { createSessionGuard } from './lib/session-guard';

export const onRequest = defineMiddleware((context, next) =>
  createSessionGuard({
    apiUrl: env.PUBLIC_API_URL,
    fetch: (input, init) => fetch(input, init),
  })(context, next),
);
