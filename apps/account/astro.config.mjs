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
  i18n: {
    defaultLocale: 'ko',
    locales: ['ko', 'en'],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
});
