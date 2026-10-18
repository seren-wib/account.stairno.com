import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Password from '../../src/pages/[locale]/password.astro';
import { en } from '../../src/i18n/en';
import { stubApi } from './api-stub';

// FR-83: the password page the account page links to.

const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function render(search = '') {
  stubApi({});
  const container = await AstroContainer.create();
  return container.renderToString(Password, {
    params: { locale: 'en' },
    request: new Request(`https://account.stairno.com/en/password${search}`, {
      headers: { cookie: 'stairno.session_token=abc' },
    }),
    locals,
  });
}

describe('password page', () => {
  it('FR-83 asks for the current password and a new one, for password managers too', async () => {
    const html = await render();
    expect(html).toMatch(/data-change-password[^>]*data-api="https:\/\/api.stairno.com"/);
    expect(html).toMatch(
      /<input[^>]*type="password"[^>]*name="currentPassword"[^>]*autocomplete="current-password"/,
    );
    expect(html).toMatch(
      /<input[^>]*type="password"[^>]*name="newPassword"[^>]*autocomplete="new-password"/,
    );
    expect(html).toContain(en.password.hint);
  });

  it('NFR-17 ties the fields to their error text', async () => {
    const html = await render();
    for (const field of ['currentPassword', 'newPassword']) {
      expect(html).toMatch(new RegExp(`aria-describedby="[^"]*\\b${field}-error"`));
    }
  });

  it('FR-83 says the password changed and the other devices were signed out, after the reload', async () => {
    expect(await render('?password=changed')).toContain(en.password.done);
    expect(await render()).not.toContain(en.password.done);
  });

  it('FR-1 never states an upper length limit', async () => {
    expect(en.password.hint).not.toMatch(/128/);
  });
});
