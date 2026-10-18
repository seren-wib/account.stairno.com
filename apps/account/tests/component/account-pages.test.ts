import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/pages/[locale]/index.astro';
import Email from '../../src/pages/[locale]/email.astro';
import Password from '../../src/pages/[locale]/password.astro';
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

// FR-29, FR-30, FR-32, FR-33 (SRS 3.5, 2026-10-18): one account page. Account, Billing, Library
// and Security in that order; the menu shows every category with its sections and jumps to
// each; no home page; email and password changes are small links to their own pages; account
// deletion is the very end of the page.

const COOKIE = 'stairno.session_token=abc';

function localsFor(emailVerified = true) {
  return {
    apiUrl: 'https://api.stairno.com',
    user: { id: 'u1', email: 'yu@example.com', name: 'Yu Seong', emailVerified, locale: 'en' },
  } as unknown as App.Locals;
}

type Page = Parameters<Awaited<ReturnType<typeof AstroContainer.create>>['renderToString']>[0];

function request(path: string) {
  return new Request(`https://account.stairno.com${path}`, { headers: { cookie: COOKIE } });
}

async function render(page: Page, path: string, locale = 'en', locals = localsFor()) {
  const container = await AstroContainer.create();
  return container.renderToString(page, { params: { locale }, request: request(path), locals });
}

function menuOf(html: string) {
  const start = html.indexOf('class="account-menu"');
  return html.slice(start, html.indexOf('</nav>', start));
}

function ids(html: string, kind: 'account-category' | 'account-section') {
  const pattern = new RegExp(`<section[^>]*class="${kind}[^"]*"[^>]*id="([^"]+)"`, 'g');
  return [...html.matchAll(pattern)].map((m) => m[1]);
}

const SECTIONS = [
  'profile',
  'sign-in',
  'payment-methods',
  'subscriptions',
  'orders',
  'downloads',
  'devices',
  'connections',
  'delete-account',
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account menu', () => {
  it('FR-29 FR-30 shows every category with its sections, in page order, each a jump on the account page', async () => {
    stubApi({});
    const menu = menuOf(await render(Home, '/en/'));
    const links = [...menu.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual([
      '/en/#account',
      '/en/#profile',
      '/en/#sign-in',
      '/en/#billing',
      '/en/#payment-methods',
      '/en/#subscriptions',
      '/en/#orders',
      '/en/#library',
      '/en/#downloads',
      '/en/#security',
      '/en/#devices',
      '/en/#connections',
      '/en/#delete-account',
    ]);
    for (const label of Object.values(en.account.menu)) expect(menu).toContain(label);
  });

  it('FR-30 tags every link with what it marks, so the category and the section in view both light up', async () => {
    stubApi({});
    const menu = menuOf(await render(Home, '/en/'));
    for (const id of ['account', 'billing', 'library', 'security']) {
      expect(menu).toMatch(new RegExp(`href="/en/#${id}"[^>]*data-category-link="${id}"`));
    }
    for (const id of SECTIONS) {
      expect(menu).toMatch(new RegExp(`href="/en/#${id}"[^>]*data-section-link="${id}"`));
    }
  });

  it('FR-76 names the categories in the page language', async () => {
    stubApi({});
    const menu = menuOf(await render(Home, '/ko/', 'ko'));
    for (const label of Object.values(ko.account.menu)) expect(menu).toContain(label);
  });

  it('FR-30 FR-32 marks only the one section a sub-page belongs to', async () => {
    stubApi({});
    for (const [page, path, section] of [
      [Email, '/en/email', 'sign-in'],
      [Password, '/en/password', 'sign-in'],
      [Orders, '/en/orders', 'orders'],
    ] as const) {
      const menu = menuOf(await render(page, path));
      const marked = [...menu.matchAll(/<a[^>]*href="([^"]+)"[^>]*aria-current="location"/g)];
      expect(marked.map((m) => m[1])).toEqual([`/en/#${section}`]);
    }
  });
});

describe('account page', () => {
  it('FR-29 stacks Account, Billing, Library and Security, and nothing like a home page', async () => {
    stubApi({});
    const html = await render(Home, '/en/');
    expect(ids(html, 'account-category')).toEqual(['account', 'billing', 'library', 'security']);
    expect(ids(html, 'account-section')).toEqual(SECTIONS);
    expect(html).not.toContain('shortcut-list');
  });

  it('DR-1 reads every list with the visitor cookie', async () => {
    const api = stubApi({});
    await render(Home, '/en/');
    for (const path of [
      '/v1/payment-methods',
      '/v1/subscriptions',
      '/v1/me/orders',
      '/v1/me/downloads',
      '/v1/sessions',
      '/v1/connections',
    ]) {
      expect(new Headers(callTo(api, path)?.[1]?.headers).get('cookie'), path).toBe(COOKIE);
    }
    const orders = callTo(api, '/v1/me/orders')?.[0] ?? '';
    expect(new URL(orders).searchParams.get('limit')).toBe('5');
  });

  it('FR-30 shows the email and the password with only a small link to change each', async () => {
    stubApi({});
    const html = await render(Home, '/en/');
    const signIn = html.slice(html.indexOf('id="sign-in"'), html.indexOf('id="billing"'));
    expect(signIn).toContain('yu@example.com');
    expect(signIn).toMatch(
      new RegExp(`<a[^>]*href="/en/email/"[^>]*>\\s*${en.account.changeEmail.replace('?', '\\?')}`),
    );
    expect(signIn).toMatch(
      new RegExp(
        `<a[^>]*href="/en/password/"[^>]*>\\s*${en.account.changePassword.replace('?', '\\?')}`,
      ),
    );
    expect(html).not.toContain('data-change-email');
    expect(html).not.toContain('data-change-password');
  });

  it('FR-2 FR-74 keeps the unconfirmed-email notice and its resend button by the email', async () => {
    stubApi({});
    const html = await render(Home, '/en/', 'en', localsFor(false));
    const signIn = html.slice(html.indexOf('id="sign-in"'), html.indexOf('id="billing"'));
    expect(signIn).toContain(en.overview.unverified);
    expect(signIn).toMatch(/data-resend-verification[^>]*data-email="yu@example.com"/);
  });

  it('FR-32 links from the latest orders to all of them', async () => {
    stubApi({});
    const html = await render(Home, '/en/');
    expect(html).toContain(en.orders.recent);
    expect(html).toContain('href="/en/orders/"');
  });

  it('FR-8 UC-12 ends the page with deletion in a red danger zone behind its own button', async () => {
    stubApi({});
    const html = await render(Home, '/en/');
    const at = html.indexOf('id="delete-account"');
    const zone = html.slice(html.lastIndexOf('<section', at));
    expect(at).toBeGreaterThan(html.indexOf('id="security"'));
    expect(zone).toMatch(/class="account-section[^"]*account-section-danger/);
    expect(zone).toContain('class="danger-zone"');
    expect(zone).toMatch(/<summary[^>]*class="[^"]*button-danger[^"]*"/);
    expect(zone).toContain(en.deleteAccount.start);
    expect(zone).toMatch(/<input[^>]*type="password"[^>]*autocomplete="current-password"/);
    expect(zone).toMatch(/<button[^>]*class="[^"]*button-danger[^"]*"[^>]*type="submit"/);
  });
});

describe('email page', () => {
  it('FR-6 shows the current address and asks for the new one, with a way back', async () => {
    stubApi({});
    const html = await render(Email, '/en/email');
    expect(html).toContain('yu@example.com');
    expect(html).toMatch(/data-change-email[^>]*data-api="https:\/\/api.stairno.com"/);
    expect(html).toContain(en.profile.emailPending);
    expect(html).toContain('href="/en/#sign-in"');
  });
});

describe('password page', () => {
  it('FR-83 asks for the current password and a new one, with a way back', async () => {
    stubApi({});
    const html = await render(Password, '/en/password');
    expect(html).toMatch(/data-change-password[^>]*data-api="https:\/\/api.stairno.com"/);
    expect(html).toContain('href="/en/#sign-in"');
  });
});

describe('old addresses', () => {
  it.each([
    [Profile, 'profile', '/en/#profile'],
    [Devices, 'devices', '/en/#devices'],
    [Connections, 'connections', '/en/#connections'],
    [Delete, 'delete', '/en/#delete-account'],
    [PaymentMethods, 'payment-methods', '/en/#payment-methods'],
    [Subscriptions, 'subscriptions', '/en/#subscriptions'],
    [Downloads, 'downloads', '/en/#downloads'],
  ])('FR-30 moves /%s permanently to its place on the account page', async (page, path, target) => {
    const container = await AstroContainer.create();
    const res = await container.renderToResponse(page as Page, {
      params: { locale: 'en' },
      request: request(`/en/${path}`),
      locals: localsFor(),
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(target);
  });

  it('FR-45 keeps the query on the way, so a card window that comes back to the old address still finishes', async () => {
    const container = await AstroContainer.create();
    const res = await container.renderToResponse(PaymentMethods, {
      params: { locale: 'en' },
      request: request('/en/payment-methods?customerKey=cus_abc&authKey=ak_1'),
      locals: localsFor(),
    });
    expect(res.headers.get('location')).toBe(
      '/en/?customerKey=cus_abc&authKey=ak_1#payment-methods',
    );
  });
});
