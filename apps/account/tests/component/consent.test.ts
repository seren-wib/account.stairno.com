import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Consent from '../../src/pages/[locale]/consent.astro';
import { en } from '../../src/i18n/en';

const QUERY =
  'response_type=code&client_id=partner&scope=openid+email+offline_access&state=s&sig=abc';
const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function render() {
  const api = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ client_id: 'partner', client_name: 'Partner Site' }),
  );
  vi.stubGlobal('fetch', api);
  const container = await AstroContainer.create();
  const html = await container.renderToString(Consent, {
    params: { locale: 'en' },
    request: new Request(`https://account.stairno.com/en/consent?${QUERY}`, {
      headers: { cookie: 'stairno.session_token=abc' },
    }),
    locals,
  });
  return { html, api };
}

describe('consent page', () => {
  it('FR-28 names the site from the API', async () => {
    const { html, api } = await render();
    expect(html).toContain('Partner Site');
    expect(api.mock.calls[0]?.[0]).toBe(
      'https://api.stairno.com/auth/oauth2/public-client?client_id=partner',
    );
  });

  it('FR-28 lists the requested scopes in words', async () => {
    const { html } = await render();
    expect(html).toContain(en.consent.scopes.email);
    expect(html).toContain(en.consent.scopes.offline_access);
    expect(html).not.toContain(en.consent.scopes.profile);
  });

  it('FR-28 FR-17 keeps the signed query for the answer and offers allow and deny', async () => {
    const { html } = await render();
    expect(html.match(/data-oauth="([^"]*)"/)?.[1]?.replaceAll('&amp;', '&')).toBe(QUERY);
    expect(html).toContain('data-accept="true"');
    expect(html).toContain('data-accept="false"');
  });
});
