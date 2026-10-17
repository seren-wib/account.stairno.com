import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorCodes } from '@stairno-account/contract';
import { apiError, validationError } from '../../src/http/errors';

describe('error responses', () => {
  it('FR-24 apiError builds only { error: { code, message } } with a listed code', async () => {
    const app = new Hono().get('/', (c) => apiError(c, 409, 'conflict', 'Already there.'));

    const res = await app.request('/');

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: { code: 'conflict', message: 'Already there.' } });
    expect(errorCodes).toContain((body as { error: { code: string } }).error.code);
  });

  it('FR-24 a 422 carries the zod issues', async () => {
    const schema = z.object({ name: z.string().min(1) });
    const app = new Hono().post('/', async (c) => {
      const parsed = schema.safeParse(await c.req.json());
      return parsed.success ? c.json(parsed.data) : validationError(c, parsed.error);
    });

    const res = await app.request('/', { method: 'POST', body: JSON.stringify({ name: '' }) });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; message: string; issues: { path: string[] }[] };
    };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.issues[0]?.path).toEqual(['name']);
  });
});
