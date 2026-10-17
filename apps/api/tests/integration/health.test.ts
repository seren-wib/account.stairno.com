import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';

describe('GET /health', () => {
  it('FR-22 answers 200 when the database answers', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('FR-22 answers 503 when the database fails', async () => {
    const { app } = await createTestApp({
      db: { execute: () => Promise.reject(new Error('connection refused')) },
    });
    const res = await app.request('/health');
    expect(res.status).toBe(503);
  });
});
