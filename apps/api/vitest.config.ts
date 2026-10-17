import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // PGlite boots a WebAssembly PostgreSQL per test file.
    testTimeout: 30_000,
  },
});
