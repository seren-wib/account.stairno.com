import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { refund, rejectRefund } from '../../src/admin/refund';
import type { Mailer } from '../../src/mail';
import { createFakeProvider } from '../../src/payments/fake';
import { renewDueSubscriptions } from '../../src/subscriptions/renew';
import { ACCOUNT_URL, API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, siteToken } from '../helpers/oidc';

// FR-65, FR-72 to FR-74: payment mails in the buyer's language. A receipt when an order is paid,
// a notice when a renewal is declined, and the outcome of a refund. Each goes out once per order,
// however often the same payment is reported, and a failed send never fails the payment.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

const RETURN_URL = 'https://stairnolabs.com/checkout/done';
const SECRET = 'test-billing-key-secret-0123456789abcdef';

async function all<T>(db: Ctx['db'], query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as { rows: T[] }).rows;
}

async function setup(options: { mailer?: Mailer; locale?: string } = {}) {
  const toss = createFakeProvider();
  const ctx = await createTestApp(
    { providers: { toss }, billingKeySecret: SECRET },
    {},
    options.mailer,
  );
  const site = await registerLabs(ctx);
  const buyer = await signUp(ctx.app);
  await ctx.db.execute(sql`
    update "user" set email_verified = true, locale = ${options.locale ?? 'ko'}
    where email = ${buyer.email}`);
  await addProduct(ctx.db, {
    sku: 'atlas-desktop',
    clientId: site.clientId,
    nameKo: '아틀라스 데스크톱',
    nameEn: 'Atlas Desktop',
    kind: 'one_time',
    prices: [{ currency: 'KRW', amount: 12000 }],
  });
  await addProduct(ctx.db, {
    sku: 'atlas-pro',
    clientId: site.clientId,
    nameKo: '아틀라스 프로',
    nameEn: 'Atlas Pro',
    kind: 'subscription',
    interval: 'month',
    prices: [{ currency: 'KRW', amount: 4900 }],
  });
  const siteBearer = await siteToken(ctx, site);
  const userBearer = (await signInToSite(ctx, site, buyer.cookie, { resource: API_URL }))
    .access_token;
  const order = async (sku: string) => {
    const res = await ctx.app.request('/v1/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${siteBearer}`,
        'x-user-token': userBearer,
      },
      body: JSON.stringify({ sku, currency: 'KRW', returnUrl: RETURN_URL }),
    });
    return (await res.json()) as {
      order: { id: string; amount: number; status: string };
      subscription?: { id: string } | null;
    };
  };
  const confirm = (orderId: string, amount: number) =>
    ctx.app.request('/v1/payments/toss/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${siteBearer}` },
      body: JSON.stringify({ paymentKey: `pay_${orderId}`, orderId, amount }),
    });
  const addCard = async () => {
    const { customerKey } = (await (
      await get(ctx.app, '/v1/payment-methods', buyer.cookie)
    ).json()) as { customerKey: string };
    await ctx.app.request('/v1/payment-methods/toss', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: buyer.cookie, origin: ACCOUNT_URL },
      body: JSON.stringify({ authKey: 'auth_1', customerKey }),
    });
  };
  return { ...ctx, toss, site, buyer, order, confirm, addCard };
}

// Mails other than the sign-up verification, which every new account gets.
const paymentMails = (ctx: Awaited<ReturnType<typeof setup>>) =>
  ctx.mailbox.sent.filter((m) => !m.text.includes('/verify-email?'));

describe('payment mails', () => {
  it('FR-72 sends one receipt in the buyer’s language when an order is paid, however often it is confirmed', async () => {
    const ctx = await setup();
    const { order } = await ctx.order('atlas-desktop');

    await ctx.confirm(order.id, order.amount);
    await ctx.confirm(order.id, order.amount);

    const mails = paymentMails(ctx);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: ctx.buyer.email });
    expect(mails[0]!.subject).toContain('영수증');
    expect(mails[0]!.text).toContain('아틀라스 데스크톱');
    expect(mails[0]!.text).toContain('₩12,000');
    expect(mails[0]!.text).toContain(`${ACCOUNT_URL}/ko/orders`);
    expect(
      await all(
        ctx.db,
        sql`select template, status, order_id = ${order.id} as for_order from mail_log
            where template <> 'verifyEmail'`,
      ),
    ).toEqual([{ template: 'receipt', status: 'sent', for_order: true }]);
  });

  it('FR-73 writes in English for an English-speaking buyer', async () => {
    const ctx = await setup({ locale: 'en' });
    const { order } = await ctx.order('atlas-desktop');

    await ctx.confirm(order.id, order.amount);

    const [mail] = paymentMails(ctx);
    expect(mail!.subject).toContain('receipt');
    expect(mail!.text).toContain('Atlas Desktop');
    expect(mail!.text).toContain(`${ACCOUNT_URL}/en/orders`);
  });

  it('FR-72 sends nothing for a declined payment', async () => {
    const ctx = await setup();
    const { order } = await ctx.order('atlas-desktop');
    ctx.toss.willDecline('REJECT_CARD_PAYMENT');

    await ctx.confirm(order.id, order.amount);

    expect(paymentMails(ctx)).toEqual([]);
  });

  it('FR-74 records a failed send and still answers the confirm', async () => {
    const failing: Mailer = {
      async send(message) {
        if (message.text.includes('/verify-email?')) return;
        throw new Error('Resend responded 500');
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = await setup({ mailer: failing });
    const { order } = await ctx.order('atlas-desktop');

    const res = await ctx.confirm(order.id, order.amount);

    expect(res.status).toBe(200);
    expect(
      await all(ctx.db, sql`select status, error from mail_log where template = 'receipt'`),
    ).toEqual([{ status: 'failed', error: 'Resend responded 500' }]);
  });

  it('FR-72 sends a receipt when a subscription starts and when it renews', async () => {
    const ctx = await setup();
    await ctx.addCard();
    const { subscription } = await ctx.order('atlas-pro');
    await ctx.db.execute(sql`
      update subscription set current_period_end = now() - interval '1 minute',
                              last_attempt_on = current_date - 1
      where id = ${subscription!.id}`);

    await renewDueSubscriptions(ctx.deps);

    const receipts = paymentMails(ctx).filter((m) => m.text.includes('₩4,900'));
    expect(receipts).toHaveLength(2);
    expect(receipts[0]!.text).toContain('아틀라스 프로');
  });

  it('FR-72 FR-55 tells the buyer when a renewal is declined, with a link to the cards', async () => {
    const ctx = await setup();
    await ctx.addCard();
    const { subscription } = await ctx.order('atlas-pro');
    await ctx.db.execute(sql`
      update subscription set current_period_end = now() - interval '1 minute',
                              last_attempt_on = current_date - 1
      where id = ${subscription!.id}`);
    ctx.toss.willDecline('REJECT_CARD_PAYMENT');

    await renewDueSubscriptions(ctx.deps);

    const [, notice] = paymentMails(ctx);
    expect(notice!.subject).toContain('갱신 결제를 하지 못했습니다');
    expect(notice!.text).toContain(`${ACCOUNT_URL}/ko/billing#payment-methods`);
  });

  it('FR-65 tells the buyer the outcome of a refund, once', async () => {
    const ctx = await setup();
    const first = (await ctx.order('atlas-desktop')).order;
    await ctx.confirm(first.id, first.amount);
    const second = (await ctx.order('atlas-desktop')).order;
    await ctx.confirm(second.id, second.amount);
    await ctx.db.execute(sql`
      insert into refund_request (order_id, user_id, reason, status)
      select id, user_id, 'Please.', 'requested' from "order" where id = ${second.id}`);

    await refund(ctx.deps, { orderId: first.id, reason: 'Does not start.' });
    await rejectRefund(ctx.deps, { orderId: second.id });
    await rejectRefund(ctx.deps, { orderId: second.id });

    const mails = paymentMails(ctx).slice(2);
    expect(mails.map((m) => m.subject)).toEqual([
      expect.stringContaining('환불했습니다'),
      expect.stringContaining('환불 요청'),
    ]);
    expect(mails[0]!.text).toContain('₩12,000');
  });

  it('NFR-21 keeps the address out of the logs', async () => {
    const logs = [
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
    const ctx = await setup();
    const { order } = await ctx.order('atlas-desktop');

    await ctx.confirm(order.id, order.amount);

    for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toContain(ctx.buyer.email);
  });
});
