import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import SignIn from '../../src/pages/[locale]/sign-in.astro';
import Forward from '../../src/routes/sign-in.astro';

const locals = { apiUrl: 'https://api.stairno.com' } as unknown as App.Locals;

async function render(locale: string, search = '') {
  const container = await AstroContainer.create();
  return container.renderToString(SignIn, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/sign-in${search}`),
    locals,
  });
}

function attr(html: string, name: string) {
  return html.match(new RegExp(`${name}="([^"]*)"`))?.[1]?.replaceAll('&amp;', '&');
}

describe('sign-in page', () => {
  it('FR-27 has email, password, a forgot-password link and a sign-up link', async () => {
    const html = await render('ko');
    expect(html).toMatch(/<input[^>]*type="email"[^>]*autocomplete="email"/);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autocomplete="current-password"/);
    expect(html).toContain('href="/ko/forgot-password/"');
    expect(html).toContain('href="/ko/sign-up/"');
    expect(attr(html, 'data-api')).toBe('https://api.stairno.com');
  });

  it('FR-17 keeps the authorization query for the API', async () => {
    const html = await render('en', '?response_type=code&client_id=labs&state=s&sig=abc');
    expect(attr(html, 'data-oauth')).toBe('response_type=code&client_id=labs&state=s&sig=abc');
  });

  it('FR-12 keeps a safe return address and drops an unsafe one', async () => {
    expect(attr(await render('en', '?redirect=%2Fen%2Fdevices'), 'data-next')).toBe('/en/devices');
    expect(attr(await render('en', '?redirect=https%3A%2F%2Fevil.example'), 'data-next')).toBe(
      '/en/',
    );
  });

  it('NFR-19 tells visitors without JavaScript that the form needs it', async () => {
    expect(await render('ko')).toContain('<noscript>');
  });
});

describe('/sign-in without a locale', () => {
  it('FR-17 FR-75 forwards to the visitor language and keeps the query', async () => {
    const container = await AstroContainer.create();
    const res = await container.renderToResponse(Forward, {
      request: new Request('https://account.stairno.com/sign-in?client_id=labs&sig=abc', {
        headers: { 'accept-language': 'en-US,en;q=0.9' },
      }),
      locals,
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/en/sign-in?client_id=labs&sig=abc');
  });
});
