import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/pages/[locale]/index.astro';
import Security from '../../src/pages/[locale]/security.astro';
import Billing from '../../src/pages/[locale]/billing.astro';
import Library from '../../src/pages/[locale]/library.astro';
import AccountPage from '../../src/pages/[locale]/account.astro';
import Orders from '../../src/pages/[locale]/orders/index.astro';
import Profile from '../../src/pages/[locale]/profile.astro';
import Devices from '../../src/pages/[locale]/devices.astro';
import Connections from '../../src/pages/[locale]/connections.astro';
import Delete from '../../src/pages/[locale]/delete.astro';
import PaymentMethods from '../../src/pages/[locale]/payment-methods.astro';
import Subscriptions from '../../src/pages/[locale]/subscriptions.astro';
import Downloads from '../../src/pages/[locale]/downloads.astro';
import { en } from '../../src/i18n/en';
import { ko } from '../../src/i18n/ko';
import { callTo, stubApi } from './api-stub';

// FR-29, FR-30, FR-32, FR-33 (SRS 3.5, 2026-10-18): five categories in a fixed menu, each one
// page of sections; account deletion at the bottom of the Account page; old paths redirect.

const COOKIE = 'stairno.session_token=abc';
const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu Seong', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

type Page = Parameters<Awaited<ReturnType<typeof AstroContainer.create>>['renderToString']>[0];

function request(path: string) {
  return new Request(`https://account.stairno.com${path}`, { headers: { cookie: COOKIE } });
}

async function render(page: Page, path: string, locale = 'en') {
  const container = await AstroContainer.create();
  return container.renderToString(page, { params: { locale }, request: request(path), locals });
}

function menuOf(html: string) {
  const start = html.indexOf('class="account-menu"');
  return html.slice(start, html.indexOf('</nav>', start));
}

// Section ids in the order they appear.
function sectionIds(html: string) {
  return [...html.matchAll(/<section[^>]*class="account-section[^"]*"[^>]*id="([^"]+)"/g)].map(
    (m) => m[1],
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account menu', () => {
  it('FR-29 FR-30 lists five categories and marks the current one', async () => {
    stubApi({});
    const menu = menuOf(await render(Security, '/en/security'));
    const links = [...menu.matchAll(/<a[^>]*href="(\/en\/[^"#]*)"/g)].map((m) => m[1]);
    expect(links).toEqual([
      '/en/',
      '/en/security/',
      '/en/billing/',
      '/en/library/',
      '/en/account/',
    ]);
    for (const label of Object.values(en.account.menu)) expect(menu).toContain(label);
    expect(menu).toMatch(/href="\/en\/security\/"[^>]*aria-current="page"/);
    expect(menu).not.toMatch(/href="\/en\/billing\/"[^>]*aria-current/);
  });

  it('FR-30 lists the sections of the current page under it', async () => {
    stubApi({});
    const menu = menuOf(await render(Security, '/en/security'));
    expect(menu).toContain('href="#devices"');
    expect(menu).toContain('href="#connections"');
    expect(menu).not.toContain('href="#payment-methods"');
  });

  it('FR-32 keeps Billing current on the full order history', async () => {
    stubApi({});
    const menu = menuOf(await render(Orders, '/en/orders'));
    expect(menu).toMatch(/href="\/en\/billing\/"[^>]*aria-current="page"/);
  });

  it('FR-76 names the categories in the page language', async () => {
    stubApi({});
    const menu = menuOf(await render(Security, '/ko/security', 'ko'));
    for (const label of Object.values(ko.account.menu)) expect(menu).toContain(label);
  });
});

describe('home', () => {
  it('FR-29 links to the four other categories with what each holds', async () => {
    const html = await render(Home, '/en/');
    const content = html.slice(html.indexOf('class="account-content"'));
    for (const page of ['security', 'billing', 'library', 'account']) {
      expect(content).toContain(`href="/en/${page}/"`);
    }
    expect(content).toContain(en.account.descriptions.security);
    expect(content).toContain(en.account.descriptions.account);
  });
});

describe('security page', () => {
  it('FR-30 FR-7 FR-21 shows the devices, then the connected sites, reading both with the cookie', async () => {
    const api = stubApi({
      '/v1/sessions': [
        200,
        {
          items: [
            {
              id: 's-phone',
              createdAt: '2026-09-20T09:00:00.000Z',
              lastUsedAt: '2026-10-10T09:00:00.000Z',
              browser: 'Safari',
              os: 'iOS',
              current: false,
            },
          ],
        },
      ],
    });
    const html = await render(Security, '/en/security');
    expect(sectionIds(html)).toEqual(['password', 'devices', 'connections']);
    expect(html).toContain(en.account.menu.security);
    expect(html).toContain('data-end-session="s-phone"');
    expect(html).toContain(en.connections.empty);
    for (const path of ['/v1/sessions', '/v1/connections']) {
      expect(new Headers(callTo(api, path)?.[1]?.headers).get('cookie')).toBe(COOKIE);
    }
  });
});

describe('billing page', () => {
  it('FR-32 shows the cards, the subscriptions and the latest orders, with a way to all of them', async () => {
    const api = stubApi({});
    const html = await render(Billing, '/en/billing');
    expect(sectionIds(html)).toEqual(['payment-methods', 'subscriptions', 'orders']);
    expect(html).toContain(en.orders.recent);
    expect(html).toContain(`href="/en/orders/"`);
    expect(html).toContain(en.orders.all);
    const orders = callTo(api, '/v1/me/orders')?.[0] ?? '';
    expect(new URL(orders).searchParams.get('limit')).toBe('5');
    for (const path of ['/v1/payment-methods', '/v1/subscriptions', '/v1/me/orders']) {
      expect(new Headers(callTo(api, path)?.[1]?.headers).get('cookie')).toBe(COOKIE);
    }
  });

  it('FR-55 sends an overdue subscription to the cards on the same page', async () => {
    stubApi({
      '/v1/subscriptions': [
        200,
        {
          items: [
            {
              id: 'sub-1',
              name: { ko: '프로', en: 'Pro' },
              status: 'past_due',
              amount: 4900,
              currency: 'KRW',
              currentPeriodEnd: '2026-11-18T00:00:00.000Z',
              cancelAtPeriodEnd: false,
              card: null,
            },
          ],
        },
      ],
    });
    expect(await render(Billing, '/en/billing')).toContain('href="/en/billing/#payment-methods"');
  });
});

describe('library page', () => {
  it('FR-33 FR-62 shows the downloads', async () => {
    const api = stubApi({
      '/v1/me/downloads': [
        200,
        {
          items: [{ sku: 'atlas-desktop', name: { ko: '아틀라스', en: 'Atlas' }, expiresAt: null }],
        },
      ],
    });
    const html = await render(Library, '/en/library');
    expect(sectionIds(html)).toEqual(['downloads']);
    expect(html).toContain('data-download-sku="atlas-desktop"');
    expect(callTo(api, '/v1/me/downloads')).toBeDefined();
  });
});

describe('account page', () => {
  it('FR-30 FR-6 shows the profile first and account deletion last', async () => {
    const html = await render(AccountPage, '/en/account');
    expect(sectionIds(html)).toEqual(['profile', 'delete-account']);
    expect(html).toMatch(/<input[^>]*name="name"[^>]*value="Yu Seong"/);
    expect(html).toMatch(/data-change-email/);
  });

  it('FR-8 UC-12 puts deletion in a red danger zone behind its own button', async () => {
    const html = await render(AccountPage, '/en/account');
    const zone = html.slice(html.lastIndexOf('<section', html.indexOf('id="delete-account"')));
    expect(zone).toMatch(/class="account-section[^"]*account-section-danger/);
    expect(zone).toContain('class="danger-zone"');
    expect(zone).toMatch(/<summary[^>]*class="[^"]*button-danger[^"]*"/);
    expect(zone.slice(zone.indexOf('<summary'), zone.indexOf('</summary>'))).toContain(
      en.deleteAccount.start,
    );
    expect(zone).toContain(en.deleteAccount.warning);
    expect(zone).toMatch(/<input[^>]*type="password"[^>]*autocomplete="current-password"/);
    expect(zone).toMatch(/<button[^>]*class="[^"]*button-danger[^"]*"[^>]*type="submit"/);
  });
});

describe('old addresses', () => {
  it.each([
    [Profile, 'profile', '/en/account/#profile'],
    [Devices, 'devices', '/en/security/#devices'],
    [Connections, 'connections', '/en/security/#connections'],
    [Delete, 'delete', '/en/account/#delete-account'],
    [PaymentMethods, 'payment-methods', '/en/billing/#payment-methods'],
    [Subscriptions, 'subscriptions', '/en/billing/#subscriptions'],
    [Downloads, 'downloads', '/en/library/#downloads'],
  ])('FR-30 moves /%s permanently to its section', async (page, path, target) => {
    const container = await AstroContainer.create();
    const res = await container.renderToResponse(page as Page, {
      params: { locale: 'en' },
      request: request(`/en/${path}`),
      locals,
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(target);
  });

  it('FR-45 keeps the query on the way, so a card window that comes back to the old address still finishes', async () => {
    const container = await AstroContainer.create();
    const res = await container.renderToResponse(PaymentMethods, {
      params: { locale: 'en' },
      request: request('/en/payment-methods?customerKey=cus_abc&authKey=ak_1'),
      locals,
    });
    expect(res.headers.get('location')).toBe(
      '/en/billing/?customerKey=cus_abc&authKey=ak_1#payment-methods',
    );
  });
});
