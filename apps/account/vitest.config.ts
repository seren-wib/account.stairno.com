/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// The Cloudflare adapter starts its own Vite server, which clashes with Vitest's.
// Component tests only need the Astro compiler, so they run without the config file.
export default getViteConfig(
  {
    test: {
      include: ['tests/**/*.test.ts'],
    },
  },
  { configFile: false },
);
