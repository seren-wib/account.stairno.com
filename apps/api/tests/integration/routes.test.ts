import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';

describe('route table', () => {
  it('FR-25 keeps every route under /v1/, /auth/, /webhooks/ or at /health', async () => {
    const { app } = await createTestApp();

    const paths = [...new Set(app.routes.map((r) => r.path))];

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      // Middleware mounted on a prefix shows up as `/v1/*`.
      expect(path).toMatch(/^(\/health$|\/v1(\/|$)|\/auth\/|\/webhooks\/|\*$|\/\*$)/);
    }
    expect(paths).toContain('/health');
    expect(paths.some((p) => p.startsWith('/v1/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/auth/'))).toBe(true);
  });
});
