import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Library from '../../src/pages/[locale]/library.astro';
import { en } from '../../src/i18n/en';
import { stubApi as stub } from './api-stub';

// FR-62, FR-29: the desktop products the user may download, each with a button that asks the
// API for a ten-minute link and follows it.

const COOKIE = 'stairno.session_token=abc';
const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

const items = [
  { sku: 'atlas-desktop', name: { ko: '아틀라스', en: 'Atlas Desktop' }, expiresAt: null },
  {
    sku: 'atlas-pro',
    name: { ko: '프로', en: 'Atlas Pro' },
    expiresAt: '2026-11-18T00:00:00.000Z',
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(status = 200, body: unknown = { items, nextCursor: null }) {
  return stub({ '/v1/me/downloads': [status, body] });
}

async function render(locale = 'en') {
  const container = await AstroContainer.create();
  return container.renderToString(Library, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/library`, {
      headers: { cookie: COOKIE },
    }),
    locals,
  });
}

describe('downloads page', () => {
  it('DR-1 reads the list from the API with the visitor cookie', async () => {
    const api = stubApi();
    await render();
    const [url, init] = api.mock.calls[0] ?? [];
    expect(url).toBe('https://api.stairno.com/v1/me/downloads');
    expect(new Headers(init?.headers).get('cookie')).toBe(COOKIE);
  });

  it('FR-62 offers each product with a download button, and says until when a subscription runs', async () => {
    stubApi();
    const html = await render();
    expect(html).toContain('Atlas Desktop');
    expect(html).toContain('data-download-sku="atlas-desktop"');
    expect(html).toContain('data-download-sku="atlas-pro"');
    expect(html).toContain(en.downloads.until);
    expect(html).toContain('Nov 18, 2026');
    expect(html).toContain(en.downloads.download);
  });

  it('says so when there is nothing, or when the list cannot be loaded', async () => {
    stubApi(200, { items: [], nextCursor: null });
    expect(await render()).toContain(en.downloads.empty);
    stubApi(500, {});
    expect(await render()).toContain(en.downloads.unavailable);
  });
});
