import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/pages/[locale]/index.astro';
import { en } from '../../src/i18n/en';
import { ko } from '../../src/i18n/ko';
import { callTo, stubApi as stub } from './api-stub';

// FR-32, FR-56, UC-8: the user's subscriptions, with cancel at the period end and resume.

const COOKIE = 'stairno.session_token=abc';
const locals = {
  apiUrl: 'https://api.stairno.com',
  user: { id: 'u1', email: 'yu@example.com', name: 'Yu', emailVerified: true, locale: 'en' },
} as unknown as App.Locals;

function item(change: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    sku: 'atlas-pro-monthly',
    name: { ko: '아틀라스 프로 월간', en: 'Atlas Pro Monthly' },
    status: 'active',
    amount: 4900,
    currency: 'KRW',
    interval: 'month',
    currentPeriodStart: '2026-10-18T00:00:00.000Z',
    currentPeriodEnd: '2026-11-18T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    card: { cardCompany: '61', cardLast4: '1234' },
    ...change,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(status = 200, body: unknown = { items: [item()], nextCursor: null }) {
  return stub({ '/v1/subscriptions': [status, body] });
}

async function render(locale = 'en') {
  const container = await AstroContainer.create();
  return container.renderToString(Home, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/`, {
      headers: { cookie: COOKIE },
    }),
    locals,
  });
}

describe('subscriptions page', () => {
  it('DR-1 reads the subscriptions from the API with the visitor cookie', async () => {
    const api = stubApi();
    await render();
    const [url, init] = callTo(api, '/v1/subscriptions') ?? [];
    expect(url).toBe('https://api.stairno.com/v1/subscriptions');
    expect(new Headers(init?.headers).get('cookie')).toBe(COOKIE);
  });

  it('FR-32 shows the plan, its status, the next charge and the card', async () => {
    stubApi();
    const html = await render();
    expect(html).toContain('Atlas Pro Monthly');
    expect(html).toContain(en.subscriptions.statuses.active);
    expect(html).toContain('₩4,900');
    expect(html).toContain('Nov 18, 2026');
    expect(html).toContain(en.paymentMethods.cards['61']);
    expect(html).toContain('1234');
  });

  it('FR-76 names the plan in the page language', async () => {
    stubApi();
    expect(await render('ko')).toContain('아틀라스 프로 월간');
  });

  it('FR-56 UC-8 offers to cancel a running subscription', async () => {
    stubApi();
    const html = await render();
    expect(html).toContain('data-cancel-subscription="sub-1"');
    expect(html).not.toContain('data-resume-subscription');
  });

  it('FR-56 shows when a canceled subscription ends and offers to resume it', async () => {
    stubApi(200, { items: [item({ cancelAtPeriodEnd: true })], nextCursor: null });
    const html = await render();
    expect(html).toContain(en.subscriptions.endsOn);
    expect(html).toContain('Nov 18, 2026');
    expect(html).toContain('data-resume-subscription="sub-1"');
    expect(html).not.toContain('data-cancel-subscription');
  });

  it('FR-55 tells an overdue subscription to check the card, with a link to the cards', async () => {
    stubApi(200, { items: [item({ status: 'past_due' })], nextCursor: null });
    const html = await render();
    expect(html).toContain(en.subscriptions.statuses.past_due);
    expect(html).toContain(en.subscriptions.overdue);
    expect(html).toContain('href="/en/#payment-methods"');
    expect(html).toContain('data-cancel-subscription="sub-1"');
  });

  it('FR-56 offers nothing for a subscription that is over', async () => {
    stubApi(200, {
      items: [item({ status: 'canceled' }), item({ id: 'sub-2', status: 'expired' })],
      nextCursor: null,
    });
    const html = await render();
    expect(html).toContain(en.subscriptions.statuses.canceled);
    expect(html).toContain(en.subscriptions.statuses.expired);
    expect(html).not.toContain('data-cancel-subscription');
    expect(html).not.toContain('data-resume-subscription');
  });

  it('says so when there is none, or when the list cannot be loaded', async () => {
    stubApi(200, { items: [], nextCursor: null });
    expect(await render()).toContain(en.subscriptions.empty);
    stubApi(500, {});
    expect(await render()).toContain(en.subscriptions.unavailable);
  });

  it('FR-76 has every subscription word in both languages', () => {
    expect(Object.keys(ko.subscriptions.statuses).sort()).toEqual(
      Object.keys(en.subscriptions.statuses).sort(),
    );
  });
});
