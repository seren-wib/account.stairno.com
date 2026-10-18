import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/pages/[locale]/index.astro';
import Email from '../../src/pages/[locale]/email.astro';
import { ko } from '../../src/i18n/ko';
import { stubApi } from './api-stub';

const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu Seong', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function render(page: typeof Home, path: string, locale = 'ko') {
  stubApi({});
  const container = await AstroContainer.create();
  return container.renderToString(page, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/${path}`),
    locals,
  });
}

describe('profile', () => {
  it('FR-6 FR-30 fills in the current name and language', async () => {
    const html = await render(Home, '');
    expect(html).toMatch(/<input[^>]*name="name"[^>]*value="Yu Seong"/);
    expect(html).toMatch(/<option[^>]*value="en"[^>]*selected/);
    expect(html).toMatch(/data-profile[^>]*data-api="https:\/\/api.stairno.com"/);
  });

  it('FR-6 changes the email on its own page, which waits for the new address', async () => {
    const html = await render(Email, 'email');
    expect(html).toContain('yu@example.com');
    expect(html).toMatch(/data-change-email[^>]*data-api="https:\/\/api.stairno.com"/);
    expect(html).toContain(ko.profile.emailPending);
  });

  it('NFR-17 ties the fields to their error text', async () => {
    expect(await render(Home, '')).toMatch(/aria-describedby="[^"]*\bname-error"/);
    expect(await render(Email, 'email')).toMatch(/aria-describedby="[^"]*\bnewEmail-error"/);
  });
});
