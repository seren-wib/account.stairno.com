import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Migrates one database snapshot for the whole run (tests/global-setup.ts).
    globalSetup: ['tests/global-setup.ts'],
    // Each test still loads its own PGlite from the snapshot, and sign-ups hash with scrypt.
    testTimeout: 30_000,
  },
});
