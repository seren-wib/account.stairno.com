import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/pages/[locale]/index.astro';
import { en } from '../../src/i18n/en';
import { ko } from '../../src/i18n/ko';
import { callTo, stubApi as stub } from './api-stub';

// FR-32, FR-45, FR-53, UC-5: the card list, and the button that opens Toss's card window.
// Card numbers are typed into Toss's window only; this page never has a field for them (DR-4).

const COOKIE = 'stairno.session_token=abc';

function localsFor(emailVerified = true) {
  return {
    apiUrl: 'https://api.stairno.com',
    user: { id: 'u1', email: 'yu@example.com', name: 'Yu', emailVerified, locale: 'en' },
  } as unknown as App.Locals;
}

const cards = {
  items: [
    {
      id: 'pm-hyundai',
      provider: 'toss',
      cardCompany: '61',
      cardLast4: '1234',
      isDefault: true,
      createdAt: '2026-10-01T09:00:00.000Z',
    },
    {
      id: 'pm-unknown',
      provider: 'toss',
      cardCompany: 'ZZ',
      cardLast4: '5678',
      isDefault: false,
      createdAt: '2026-10-10T09:00:00.000Z',
    },
  ],
  customerKey: 'cus_abc',
  clientKey: 'test_ck_not_a_real_key',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(status = 200, body: unknown = cards) {
  return stub({ '/v1/payment-methods': [status, body] });
}

async function render(locale = 'en', locals = localsFor()) {
  const container = await AstroContainer.create();
  return container.renderToString(Home, {
    params: { locale },
    request: new Request(`https://account.stairno.com/${locale}/`, {
      headers: { cookie: COOKIE },
    }),
    locals,
  });
}

describe('payment methods page', () => {
  it('DR-1 reads the cards from the API with the visitor cookie', async () => {
    const api = stubApi();
    await render();
    const [url, init] = callTo(api, '/v1/payment-methods') ?? [];
    expect(url).toBe('https://api.stairno.com/v1/payment-methods');
    expect(new Headers(init?.headers).get('cookie')).toBe(COOKIE);
  });

  it('FR-53 lists each card by its company and last four digits, the default marked', async () => {
    stubApi();
    const html = await render();
    expect(html).toContain(en.paymentMethods.cards['61']);
    expect(html).toContain('1234');
    expect(html).toContain('5678');
    expect(html).toContain(en.paymentMethods.default);
    expect(html).toContain('Oct 1, 2026');
  });

  it('FR-76 names the card company in the page language', async () => {
    stubApi();
    expect(await render('ko', localsFor())).toContain(ko.paymentMethods.cards['61']);
  });

  it('FR-53 names a card company it does not know plainly', async () => {
    stubApi();
    expect(await render()).toContain(en.paymentMethods.unknownCard);
  });

  it('FR-53 offers to remove every card and to make the other one the default', async () => {
    stubApi();
    const html = await render();
    expect(html).toContain('data-remove-card="pm-hyundai"');
    expect(html).toContain('data-remove-card="pm-unknown"');
    expect(html).toContain('data-make-default="pm-unknown"');
    expect(html).not.toContain('data-make-default="pm-hyundai"');
  });

  it('FR-45 UC-5 opens the card window with the client key and this user’s customerKey', async () => {
    stubApi();
    const html = await render();
    expect(html).toMatch(/data-add-card[^>]*data-client-key="test_ck_not_a_real_key"/);
    expect(html).toMatch(/data-add-card[^>]*data-customer-key="cus_abc"/);
    expect(html).toContain(en.paymentMethods.add);
  });

  it('DR-4 has no field for a card number, expiry or CVC', async () => {
    stubApi();
    const html = await render();
    const cardsSection = html.slice(
      html.indexOf('id="payment-methods"'),
      html.indexOf('id="subscriptions"'),
    );
    expect(cardsSection).not.toMatch(/<input/);
  });

  it('FR-2 asks for a verified email before a card can be added', async () => {
    stubApi();
    const html = await render('en', localsFor(false));
    expect(html).toContain(en.paymentMethods.verifyFirst);
    expect(html).not.toContain('data-add-card');
  });

  it('FR-45 says cards cannot be added yet when Toss is not set up', async () => {
    stubApi(200, { ...cards, clientKey: null });
    const html = await render();
    expect(html).toContain(en.paymentMethods.addUnavailable);
    expect(html).not.toContain('data-add-card');
    expect(html).toContain('1234');
  });

  it('says so when there is no card yet', async () => {
    stubApi(200, { ...cards, items: [] });
    expect(await render()).toContain(en.paymentMethods.empty);
  });

  it('says so when the list cannot be loaded', async () => {
    stubApi(503, { error: { code: 'payments_off', message: 'x' } });
    const html = await render();
    expect(html).toContain(en.paymentMethods.unavailable);
    expect(html).not.toContain('data-add-card');
  });
});
