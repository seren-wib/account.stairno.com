import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import AccountPage from '../../src/pages/[locale]/account.astro';
import { ko } from '../../src/i18n/ko';

const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu Seong', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

async function render(locale = 'ko') {
  const container = await AstroContainer.create();
  return container.renderToString(AccountPage, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/account`),
    locals,
  });
}

describe('profile page', () => {
  it('FR-6 FR-30 fills in the current name and language', async () => {
    const html = await render();
    expect(html).toMatch(/<input[^>]*name="name"[^>]*value="Yu Seong"/);
    expect(html).toMatch(/<option[^>]*value="en"[^>]*selected/);
    expect(html).toMatch(/data-profile[^>]*data-api="https:\/\/api.stairno.com"/);
  });

  it('FR-6 offers an email change that waits for the new address', async () => {
    const html = await render();
    expect(html).toContain('yu@example.com');
    expect(html).toMatch(/data-change-email[^>]*data-api="https:\/\/api.stairno.com"/);
    expect(html).toContain(ko.profile.emailPending);
  });

  it('NFR-17 ties the fields to their error text', async () => {
    const html = await render();
    for (const field of ['name', 'newEmail']) {
      expect(html).toMatch(new RegExp(`aria-describedby="[^"]*\\b${field}-error"`));
    }
  });
});
