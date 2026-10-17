import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Root from '../../src/pages/index.astro';

const locals = { apiUrl: 'https://api.stairno.com' } as unknown as App.Locals;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubMe(locale: string | null) {
  const api = vi.fn(async (_url: string, _init?: RequestInit) =>
    locale
      ? Response.json({ id: 'u1', locale })
      : Response.json({ error: { code: 'unauthorized', message: 'x' } }, { status: 401 }),
  );
  vi.stubGlobal('fetch', api);
  return api;
}

async function visit(headers: Record<string, string>) {
  const container = await AstroContainer.create();
  const res = await container.renderToResponse(Root, {
    request: new Request('https://account.stairno.com/', { headers }),
    locals,
  });
  return { status: res.status, location: res.headers.get('location') };
}

describe('/', () => {
  it('FR-75 follows the signed-in user language over the browser', async () => {
    const api = stubMe('en');
    const res = await visit({ cookie: 'stairno.session_token=abc', 'accept-language': 'ko-KR' });
    expect(res).toEqual({ status: 302, location: '/en/' });
    const [url, init] = api.mock.calls[0] ?? [];
    expect(url).toBe('https://api.stairno.com/v1/me');
    expect(new Headers(init?.headers).get('cookie')).toBe('stairno.session_token=abc');
  });

  it('FR-75 uses the browser language without a session', async () => {
    const api = stubMe(null);
    expect(await visit({ 'accept-language': 'en-US,en;q=0.9' })).toEqual({
      status: 302,
      location: '/en/',
    });
    expect(api).not.toHaveBeenCalled();
  });

  it('FR-75 falls back to ko', async () => {
    stubMe(null);
    expect(await visit({ cookie: 'expired=1', 'accept-language': 'fr' })).toEqual({
      status: 302,
      location: '/ko/',
    });
  });
});
