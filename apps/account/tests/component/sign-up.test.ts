import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import { termsVersion } from '@stairno-account/contract';
import SignUp from '../../src/pages/[locale]/sign-up.astro';
import SignIn from '../../src/pages/[locale]/sign-in.astro';

const locals = { apiUrl: 'https://api.stairno.com' } as unknown as App.Locals;
const OIDC = '?response_type=code&client_id=labs&state=s&sig=abc';

async function render(page: typeof SignUp, locale: string, path: string, search = '') {
  const container = await AstroContainer.create();
  return container.renderToString(page, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/${path}${search}`),
    locals,
  });
}

function attr(html: string, name: string) {
  return html.match(new RegExp(`${name}="([^"]*)"`))?.[1]?.replaceAll('&amp;', '&');
}

describe('sign-up page', () => {
  it('FR-27 has name, email and new-password fields', async () => {
    const html = await render(SignUp, 'ko', 'sign-up');
    expect(html).toMatch(/<input[^>]*name="name"[^>]*autocomplete="name"/);
    expect(html).toMatch(/<input[^>]*type="email"[^>]*autocomplete="email"/);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autocomplete="new-password"/);
  });

  it('FR-9 asks to accept the terms and privacy policy, naming the version', async () => {
    const html = await render(SignUp, 'en', 'sign-up');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="acceptTerms"/);
    expect(html).toContain('href="/en/terms/"');
    expect(html).toContain('href="/en/privacy/"');
    expect(html).toContain(termsVersion);
    expect(attr(html, 'data-terms-version')).toBe(termsVersion);
  });

  it('FR-78 sends the page language as the account language', async () => {
    expect(attr(await render(SignUp, 'en', 'sign-up'), 'data-locale')).toBe('en');
  });

  it('NFR-17 ties each field to its error text', async () => {
    const html = await render(SignUp, 'ko', 'sign-up');
    for (const field of ['name', 'email', 'password', 'acceptTerms']) {
      expect(html).toMatch(new RegExp(`aria-describedby="[^"]*\\b${field}-error"`));
      expect(html).toContain(`id="${field}-error"`);
    }
  });

  it('FR-27 keeps the sign-in link inside the form, so it hides with the form once mail is sent', async () => {
    const html = await render(SignUp, 'ko', 'sign-up');
    const form = html.slice(html.indexOf('data-sign-up'), html.indexOf('</form>'));
    expect(form).toContain('class="form-links"');
  });

  it('FR-27 puts a space between the sign-in question and its link', async () => {
    const html = await render(SignIn, 'ko', 'sign-in');
    expect(html).toMatch(/계정이 없나요\?\s+<a/);
  });

  it('FR-17 keeps the authorization query on the links between sign-in and sign-up', async () => {
    const signUp = await render(SignUp, 'en', 'sign-up', OIDC);
    const signIn = await render(SignIn, 'en', 'sign-in', OIDC);
    expect(signUp).toContain(`href="/en/sign-in/${OIDC.replaceAll('&', '&amp;')}"`);
    expect(signIn).toContain(`href="/en/sign-up/${OIDC.replaceAll('&', '&amp;')}"`);
    expect(attr(signUp, 'data-oauth')).toBe(OIDC.slice(1));
  });

  it.each([
    ['sign-in', SignIn],
    ['sign-up', SignUp],
  ])('FR-81 lets %s return to the hub', async (path, page) => {
    const html = await render(page, 'ko', path, '?redirect=https%3A%2F%2Fstairno.com%2Fko%2F');
    expect(attr(html, 'data-next')).toBe('https://stairno.com/ko/');
  });

  it.each([
    'https://stairno.com.evil.example/ko/',
    'http://stairno.com/ko/',
    'https://evil.example/?https://stairno.com/',
  ])('FR-81 does not mistake %s for the hub', async (target) => {
    const html = await render(SignIn, 'ko', 'sign-in', `?redirect=${encodeURIComponent(target)}`);
    expect(attr(html, 'data-next')).toBe('/ko/');
  });
});
