// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://account.stairno.com',
  output: 'server',
  // Sessions live in the API (Better Auth). Astro sessions would add an unused KV binding.
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  trailingSlash: 'ignore',
  // NFR-7 (SDD §9): hashes for the scripts and styles Astro emits, the theme script included.
  // connect-src and img-src are added per request by the layout, since the API host is a runtime
  // value.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        'font-src https://cdn.jsdelivr.net',
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
      styleDirective: { resources: ["'self'", 'https://cdn.jsdelivr.net'] },
    },
  },
  i18n: {
    defaultLocale: 'ko',
    locales: ['ko', 'en'],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
});
