import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/pages/[locale]/index.astro';
import { apiGet } from '../../src/lib/api';
import { en } from '../../src/i18n/en';
import { stubApi as stub } from './api-stub';

const COOKIE = 'stairno.session_token=abc';
const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

const sessions = {
  items: [
    {
      id: 's-laptop',
      createdAt: '2026-10-01T09:00:00.000Z',
      lastUsedAt: '2026-10-17T09:00:00.000Z',
      browser: 'Chrome',
      os: 'Windows',
      current: true,
    },
    {
      id: 's-phone',
      createdAt: '2026-09-20T09:00:00.000Z',
      lastUsedAt: '2026-10-10T09:00:00.000Z',
      browser: 'Safari',
      os: 'iOS',
      current: false,
    },
  ],
  nextCursor: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(status = 200, body: unknown = sessions) {
  return stub({ '/v1/sessions': [status, body] });
}

async function render() {
  const container = await AstroContainer.create();
  return container.renderToString(Home, {
    params: { locale: 'en' },
    request: new Request('https://account.stairno.com/en/', {
      headers: { cookie: COOKIE },
    }),
    locals,
  });
}

describe('apiGet', () => {
  it('DR-1 FR-12 reads /v1 with the visitor cookie', async () => {
    const api = stubApi();

    const result = await apiGet(
      locals,
      new Request('https://account.stairno.com/en/devices', { headers: { cookie: COOKIE } }),
      '/v1/sessions',
    );

    expect(result).toEqual(sessions);
    const [url, init] = api.mock.calls[0] ?? [];
    expect(url).toBe('https://api.stairno.com/v1/sessions');
    expect(new Headers(init?.headers).get('cookie')).toBe(COOKIE);
  });

  it('returns null when the API fails', async () => {
    stubApi(500, { error: { code: 'internal_error', message: 'x' } });
    expect(
      await apiGet(locals, new Request('https://account.stairno.com/'), '/v1/sessions'),
    ).toBeNull();
  });
});

describe('devices page', () => {
  it('FR-7 lists each device with its browser, system and dates', async () => {
    stubApi();
    const html = await render();
    expect(html).toContain('Chrome');
    expect(html).toContain('Windows');
    expect(html).toContain('Safari');
    expect(html).toContain('iOS');
    expect(html).toContain('Oct 17, 2026');
    expect(html).toContain('Sep 20, 2026');
  });

  it('FR-7 marks this device and offers to end only the others', async () => {
    stubApi();
    const html = await render();
    expect(html).toContain(en.devices.current);
    expect(html).toContain('data-end-session="s-phone"');
    expect(html).not.toContain('data-end-session="s-laptop"');
  });

  it('FR-4 offers to sign out on every other device', async () => {
    stubApi();
    expect(await render()).toMatch(/data-sign-out-others[^>]*data-api="https:\/\/api.stairno.com"/);
  });

  it('says so when the list cannot be loaded', async () => {
    stubApi(500, {});
    const html = await render();
    expect(html).toContain(en.devices.unavailable);
    expect(html).not.toContain('data-end-session');
  });
});
