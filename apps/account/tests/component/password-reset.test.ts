import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Forgot from '../../src/pages/[locale]/forgot-password.astro';
import Reset from '../../src/pages/[locale]/reset-password.astro';
import { en } from '../../src/i18n/en';

const locals = { apiUrl: 'https://api.stairno.com' } as unknown as App.Locals;

async function render(page: typeof Forgot, locale: string, path: string) {
  const container = await AstroContainer.create();
  return container.renderToString(page, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/${path}`),
    locals,
  });
}

function attr(html: string, name: string) {
  return html.match(new RegExp(`${name}="([^"]*)"`))?.[1]?.replaceAll('&amp;', '&');
}

describe('forgot-password page', () => {
  it('FR-5 FR-27 asks for the email and never says whether it has an account', async () => {
    const html = await render(Forgot, 'en', 'forgot-password');
    expect(html).toMatch(/<input[^>]*type="email"[^>]*autocomplete="email"/);
    expect(html).toContain(en.forgotPassword.sentBody);
    expect(attr(html, 'data-api')).toBe('https://api.stairno.com');
  });
});

describe('reset-password page', () => {
  it('FR-5 FR-27 carries the token from the mail and asks for a new password', async () => {
    const html = await render(Reset, 'en', 'reset-password?token=abc123');
    expect(attr(html, 'data-token')).toBe('abc123');
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autocomplete="new-password"/);
    expect(html).toContain('href="/en/sign-in/"');
    expect(html).toContain('href="/en/forgot-password/"');
  });

  it('FR-5 shows the expired-link state when the address has no token', async () => {
    const html = await render(Reset, 'ko', 'reset-password');
    expect(html).not.toContain('data-reset-password');
    expect(html).toContain('href="/ko/forgot-password/"');
  });
});
