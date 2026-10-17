import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('error format', () => {
  it('FR-24 answers an unknown path with 404 not_found', async () => {
    const { app } = await createTestApp();

    const res = await app.request('/nothing-here');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it('FR-24 answers an unknown /v1 path with 404 once signed in (401 before)', async () => {
    stubPwnedPasswords();
    const { app } = await createTestApp();
    const { cookie } = await signUp(app);

    const res = await get(app, '/v1/nothing-here', cookie);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
    expect((await app.request('/v1/nothing-here')).status).toBe(401);
  });

  it('FR-24 NFR-21 turns an unexpected failure into 500 internal_error without internals', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, auth } = await createTestApp();
    vi.spyOn(auth.api, 'getSession').mockRejectedValue(new Error('connection reset by peer'));

    const res = await app.request('/v1/me', {
      headers: { cookie: 'stairno.session_token=x', 'x-user-email': 'someone@example.com' },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: { code: 'internal_error', message: expect.any(String) } });
    expect(JSON.stringify(body)).not.toContain('connection reset');
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('someone@example.com');
  });
});
