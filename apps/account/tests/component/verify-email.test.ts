import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VerifyEmail from '../../src/pages/[locale]/verify-email.astro';
import { en } from '../../src/i18n/en';

const locals = { apiUrl: 'https://api.stairno.com' } as unknown as App.Locals;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(status: number) {
  const api = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json(status === 200 ? { status: true } : { code: 'INVALID_TOKEN' }, { status }),
  );
  vi.stubGlobal('fetch', api);
  return api;
}

async function render(search: string, cookie = 'stairno.session_token=abc') {
  const container = await AstroContainer.create();
  return container.renderToString(VerifyEmail, {
    params: { locale: 'en' },
    request: new Request(`https://account.stairno.com/en/verify-email${search}`, {
      headers: { cookie },
    }),
    locals,
  });
}

describe('verify-email page', () => {
  it('FR-2 confirms the address with the token from the mail', async () => {
    const api = stubApi(200);

    const html = await render('?token=tok123');

    expect(html).toContain(en.verifyEmail.done);
    expect(html).toContain('href="/en/"');
    const [url, init] = api.mock.calls[0] ?? [];
    expect(url).toBe('https://api.stairno.com/auth/verify-email?token=tok123');
    expect(new Headers(init?.headers).get('cookie')).toBe('stairno.session_token=abc');
  });

  it('FR-2 FR-6 explains an expired or used link', async () => {
    stubApi(401);

    const html = await render('?token=old');

    expect(html).toContain(en.verifyEmail.expired);
    expect(html).not.toContain(en.verifyEmail.done);
  });

  it('FR-2 does not call the API without a token', async () => {
    const api = stubApi(200);

    const html = await render('');

    expect(api).not.toHaveBeenCalled();
    expect(html).toContain(en.verifyEmail.expired);
  });
});
