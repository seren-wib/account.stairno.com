import type { APIContext } from 'astro';
import { describe, expect, it, vi } from 'vitest';
import { createSessionGuard, type SessionUser } from '../../src/lib/session-guard';

const API_URL = 'https://api.stairno.com';
const COOKIE = '__Secure-stairno.session_token=abc.def; theme=dark';

const user: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'user@example.com',
  name: 'Test User',
  emailVerified: false,
  locale: 'ko',
};

function fakeApi(signedIn: boolean) {
  return vi.fn(async (_input: string, _init?: RequestInit) =>
    Response.json(signedIn ? { user, session: { id: 's1' } } : null),
  );
}

async function visit(path: string, fetchFn: ReturnType<typeof fakeApi>, cookie = COOKIE) {
  const url = new URL(path, 'https://account.stairno.com');
  const locals = {} as App.Locals;
  const context = {
    url,
    request: new Request(url, { headers: cookie ? { cookie } : {} }),
    locals,
    redirect: (location: string, status = 302) =>
      new Response(null, { status, headers: { location } }),
  } as unknown as APIContext;
  const next = vi.fn(async () => new Response('page'));
  const guard = createSessionGuard({ apiUrl: API_URL, fetch: fetchFn });
  const res = await guard(context, next);
  return { res, next, locals };
}

describe('session guard', () => {
  it('FR-12 sends a signed-out visitor to sign-in with the way back', async () => {
    const { res, next } = await visit('/ko/profile?tab=name', fakeApi(false));

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '', 'https://account.stairno.com');
    expect(location.pathname).toBe('/ko/sign-in');
    expect(location.searchParams.get('redirect')).toBe('/ko/profile?tab=name');
    expect(next).not.toHaveBeenCalled();
  });

  it('FR-12 DR-1 forwards the incoming Cookie header to get-session as it is', async () => {
    const api = fakeApi(true);
    await visit('/en/devices', api);

    expect(api).toHaveBeenCalledTimes(1);
    const [url, init] = api.mock.calls[0] ?? [];
    expect(url).toBe(`${API_URL}/auth/get-session`);
    expect(new Headers(init?.headers).get('cookie')).toBe(COOKIE);
  });

  it('FR-12 renders the page for a signed-in user and keeps the user in locals', async () => {
    const { res, next, locals } = await visit('/ko/', fakeApi(true));

    expect(await res.text()).toBe('page');
    expect(next).toHaveBeenCalledTimes(1);
    expect(locals.user).toEqual(user);
  });

  it.each([
    '/ko/sign-in',
    '/en/sign-up',
    '/ko/forgot-password',
    '/ko/reset-password',
    '/en/verify-email',
    '/ko/terms',
    '/en/privacy',
    '/',
    '/404',
  ])('FR-12 lets %s through without a session', async (path) => {
    const { res } = await visit(path, fakeApi(false));
    expect(res.status).toBe(200);
  });

  it('FR-12 does not call the API without a cookie', async () => {
    const api = fakeApi(true);
    const { res } = await visit('/ko/profile', api, '');

    expect(api).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
  });

  it('FR-12 treats an unreachable API as signed out', async () => {
    const api = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const { res } = await visit('/ko/profile', api as unknown as ReturnType<typeof fakeApi>);
    expect(res.status).toBe(302);
  });
});
