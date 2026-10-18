import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import AccountPage from '../../src/pages/[locale]/account.astro';
import { deleteError } from '../../src/lib/delete-form';
import { en } from '../../src/i18n/en';

const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

async function render() {
  const container = await AstroContainer.create();
  return container.renderToString(AccountPage, {
    params: { locale: 'en' },
    request: new Request('https://account.stairno.com/en/account'),
    locals,
  });
}

describe('deleteError', () => {
  it.each([
    [400, 'INVALID_PASSWORD', { field: 'password', key: 'password' }],
    [400, 'Password is required', { field: 'password', key: 'password' }],
    [429, undefined, { field: 'form', key: 'tooMany' }],
    [500, undefined, { field: 'form', key: 'unavailable' }],
  ])('FR-8 NFR-17 maps %s %s', (status, code, expected) => {
    expect(deleteError(status, code)).toEqual(expected);
  });
});

describe('delete page', () => {
  it('FR-8 explains what goes and that it cannot be undone', async () => {
    const html = await render();
    expect(html).toContain(en.deleteAccount.warning);
  });

  it('FR-8 asks for the password again and a confirmation', async () => {
    const html = await render();
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autocomplete="current-password"/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="confirm"/);
    expect(html).toMatch(/data-delete-account[^>]*data-api="https:\/\/api.stairno.com"/);
    for (const field of ['password', 'confirm']) {
      expect(html).toMatch(new RegExp(`aria-describedby="[^"]*\\b${field}-error"`));
    }
  });

  it('FR-8 points to the hub once the account is gone', async () => {
    expect(await render()).toContain('href="https://stairno.com/en/"');
  });
});
