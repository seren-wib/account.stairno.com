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

async function render(
  page: typeof Home,
  path: string,
  locale = 'ko',
  as: App.Locals = locals,
  routes: Parameters<typeof stubApi>[0] = {},
) {
  stubApi(routes);
  const container = await AstroContainer.create();
  return container.renderToString(page, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/${path}`),
    locals: as,
  });
}

describe('profile', () => {
  it('FR-6 FR-30 fills in the current name and language', async () => {
    const html = await render(Home, '');
    expect(html).toMatch(/<input[^>]*name="name"[^>]*value="Yu Seong"/);
    expect(html).toMatch(/<option[^>]*value="en"[^>]*selected/);
    expect(html).toMatch(/data-profile[^>]*data-api="https:\/\/api.stairno.com"/);
  });

  it('FR-85 shows the photo, with a way to change it and to remove it', async () => {
    const image = 'https://api.stairno.com/v1/avatars/u1/0123456789abcdef.webp';
    const html = await render(Home, '', 'en', {
      ...locals,
      user: { ...locals.user, image },
    } as unknown as App.Locals);
    const photo = html.slice(html.indexOf('data-photo'), html.indexOf('data-profile'));
    expect(photo).toContain(`src="${image}"`);
    expect(photo).toMatch(/<input[^>]*type="file"[^>]*accept="image\/png,image\/jpeg,image\/webp"/);
    expect(photo).toContain('data-photo-remove');
    expect(photo).toContain('data-api="https://api.stairno.com"');
  });

  it('FR-85 shows the first letter of the name without a photo, and nothing to remove', async () => {
    const html = await render(Home, '', 'en');
    const photo = html.slice(html.indexOf('data-photo'), html.indexOf('data-profile'));
    expect(photo).toMatch(/data-photo-initial[^>]*>\s*Y\s*</);
    expect(photo).not.toContain('<img');
    expect(photo).not.toContain('data-photo-remove');
  });

  it('FR-84 offers the country and the time zone, both optional, with the current ones chosen', async () => {
    const html = await render(Home, '', 'ko', {
      ...locals,
      user: { ...locals.user, country: 'KR', timezone: 'Asia/Seoul' },
    } as unknown as App.Locals);
    expect(html).toMatch(/<select[^>]*name="country"/);
    expect(html).toMatch(/<option[^>]*value="KR"[^>]*selected[^>]*>\s*대한민국/);
    expect(html).toMatch(/<option[^>]*value="US"[^>]*>\s*미국/);
    expect(html).toMatch(/<select[^>]*name="country"[^>]*>\s*<option value=""/);
    expect(html).toMatch(/<select[^>]*name="timezone"/);
    expect(html).toMatch(/<option[^>]*value="Asia\/Seoul"[^>]*selected/);
    expect(html).toMatch(/<option[^>]*value="UTC"/);
  });

  it('FR-84 leaves both on "not set" for a user without them', async () => {
    const html = await render(Home, '');
    expect(html).not.toMatch(/<option[^>]*value="KR"[^>]*selected/);
    expect(html).toMatch(/<option value=""[^>]*selected/);
  });

  it('FR-84 dates the lists in the user time zone', async () => {
    const html = await render(
      Home,
      '',
      'en',
      {
        ...locals,
        user: { ...locals.user, timezone: 'Asia/Seoul' },
      } as unknown as App.Locals,
      {
        '/v1/sessions': [
          200,
          {
            items: [
              {
                id: 's1',
                createdAt: '2026-10-18T16:30:00.000Z',
                lastUsedAt: '2026-10-18T16:30:00.000Z',
                browser: 'Chrome',
                os: 'Windows',
                current: true,
              },
            ],
          },
        ],
      },
    );
    const devices = html.slice(html.indexOf('id="devices"'), html.indexOf('id="connections"'));
    expect(devices).toContain('Oct 19, 2026');
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
