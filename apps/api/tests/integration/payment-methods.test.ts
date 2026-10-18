import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { addProduct } from '../../src/admin/add-product';
import { decryptBillingKey } from '../../src/payments/billing-keys';
import { createFakeProvider } from '../../src/payments/fake';
import { ACCOUNT_URL, API_URL, createTestApp } from '../helpers/app';
import { get, signUp } from '../helpers/auth';
import { stubPwnedPasswords } from '../helpers/hibp';
import { registerLabs, signInToSite, siteToken } from '../helpers/oidc';

// FR-45, FR-53, FR-54: the account center registers a card through Toss's card window and the
// API keeps the billing key, encrypted (DR-4). Only the account center's own session manages cards.

beforeEach(() => {
  stubPwnedPasswords();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

const SECRET = 'test-billing-key-secret-0123456789abcdef';

async function setup() {
  const toss = createFakeProvider();
  const ctx = await createTestApp({ providers: { toss }, billingKeySecret: SECRET });
  const buyer = await signUp(ctx.app);
  await ctx.db.execute(sql`update "user" set email_verified = true where email = ${buyer.email}`);
  const send = (method: string, path: string, body?: unknown, origin = ACCOUNT_URL) =>
    ctx.app.request(path, {
      method,
      headers: { 'content-type': 'application/json', cookie: buyer.cookie, origin },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const list = async () =>
    (await (await get(ctx.app, '/v1/payment-methods', buyer.cookie)).json()) as {
      items: { id: string; cardCompany: string; cardLast4: string; isDefault: boolean }[];
      customerKey: string;
    };
  const register = async (authKey = 'auth_1') =>
    send('POST', '/v1/payment-methods/toss', { authKey, customerKey: (await list()).customerKey });
  return { ...ctx, toss, buyer, send, list, register };
}

async function rows(db: Ctx['db']) {
  return (
    (await db.execute(
      sql`select billing_key, customer_key, is_default, deleted_at from payment_method order by created_at`,
    )) as {
      rows: {
        billing_key: string;
        customer_key: string;
        is_default: boolean;
        deleted_at: unknown;
      }[];
    }
  ).rows;
}

const calls = (fake: ReturnType<typeof createFakeProvider>, method: string) =>
  fake.calls.filter((call) => call.method === method);

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('GET /v1/payment-methods', () => {
  it('FR-45 gives the account center a customerKey before any card exists, the same each time', async () => {
    const ctx = await setup();

    const first = await ctx.list();
    const again = await ctx.list();

    expect(first).toEqual({
      items: [],
      customerKey: expect.stringMatching(/^[A-Za-z0-9_\-=.@]{2,50}$/),
    });
    expect(again.customerKey).toBe(first.customerKey);
  });
});

describe('POST /v1/payment-methods/toss', () => {
  it('FR-45 DR-4 issues the billing key at Toss and keeps it encrypted', async () => {
    const ctx = await setup();
    const { customerKey } = await ctx.list();

    const res = await ctx.register();

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      paymentMethod: {
        id: expect.any(String),
        provider: 'toss',
        cardCompany: 'Fake Card',
        cardLast4: '4242',
        isDefault: true,
        createdAt: expect.any(String),
      },
    });
    expect(JSON.stringify(body)).not.toContain('fake_billing_');
    expect(calls(ctx.toss, 'issueBillingKey')).toEqual([
      { method: 'issueBillingKey', input: { customerKey, authKey: 'auth_1' } },
    ]);
    const [row] = await rows(ctx.db);
    expect(row?.billing_key).not.toContain('fake_billing_');
    await expect(decryptBillingKey(SECRET, row!.billing_key)).resolves.toBe('fake_billing_1');
    expect(row?.customer_key).toBe(customerKey);
  });

  it('FR-53 keeps the first card as default and adds the next ones beside it', async () => {
    const ctx = await setup();
    await ctx.register('auth_1');
    await ctx.register('auth_2');

    const { items, customerKey } = await ctx.list();

    expect(items.map((m) => m.isDefault)).toEqual([true, false]);
    expect(new Set((await rows(ctx.db)).map((r) => r.customer_key))).toEqual(
      new Set([customerKey]),
    );
  });

  it('FR-45 refuses another customerKey and asks Toss nothing', async () => {
    const ctx = await setup();

    const res = await ctx.send('POST', '/v1/payment-methods/toss', {
      authKey: 'auth_1',
      customerKey: 'cus_someone_else',
    });

    expect(res.status).toBe(422);
    expect(calls(ctx.toss, 'issueBillingKey')).toEqual([]);
  });

  it('FR-2 refuses a user whose email is not verified', async () => {
    const ctx = await setup();
    await ctx.db.execute(
      sql`update "user" set email_verified = false where email = ${ctx.buyer.email}`,
    );

    const res = await ctx.register();

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('email_not_verified');
  });

  it('FR-45 answers 422 when Toss refuses the card and keeps nothing', async () => {
    const ctx = await setup();
    ctx.toss.willDecline('INVALID_CARD_NUMBER');

    const res = await ctx.register();

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: {
        code: 'validation_failed',
        issues: [{ path: ['authKey'], message: 'INVALID_CARD_NUMBER' }],
      },
    });
    expect(await rows(ctx.db)).toEqual([]);
  });

  it('FR-45 answers 502 when Toss cannot be reached and keeps nothing', async () => {
    const ctx = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ctx.toss.willThrow();

    const res = await ctx.register();

    expect(res.status).toBe(502);
    expect(await rows(ctx.db)).toEqual([]);
  });

  it('NFR-5 refuses a registration from another origin', async () => {
    const ctx = await setup();
    const { customerKey } = await ctx.list();

    const res = await ctx.send(
      'POST',
      '/v1/payment-methods/toss',
      { authKey: 'auth_1', customerKey },
      'https://evil.example',
    );

    expect(res.status).toBe(403);
    expect(calls(ctx.toss, 'issueBillingKey')).toEqual([]);
  });
});

describe('DELETE /v1/payment-methods/{id}', () => {
  it('FR-53 removes the billing key at Toss, then the card, and the other card becomes default', async () => {
    const ctx = await setup();
    await ctx.register('auth_1');
    await ctx.register('auth_2');
    const [first] = (await ctx.list()).items;

    const res = await ctx.send('DELETE', `/v1/payment-methods/${first!.id}`);

    expect(res.status).toBe(204);
    expect(calls(ctx.toss, 'deleteBillingKey')).toEqual([
      { method: 'deleteBillingKey', input: 'fake_billing_1' },
    ]);
    expect((await ctx.list()).items).toEqual([expect.objectContaining({ isDefault: true })]);
    expect((await rows(ctx.db))[0]?.deleted_at).not.toBeNull();
  });

  it('FR-45 keeps the customerKey after the last card is gone', async () => {
    const ctx = await setup();
    const before = (await ctx.list()).customerKey;
    await ctx.register();
    const [card] = (await ctx.list()).items;
    await ctx.send('DELETE', `/v1/payment-methods/${card!.id}`);

    expect((await ctx.list()).customerKey).toBe(before);
  });

  it('FR-54 refuses to remove a card a subscription pays with', async () => {
    const ctx = await setup();
    await ctx.register();
    const [card] = (await ctx.list()).items;
    const site = await registerLabs(ctx);
    await addProduct(ctx.db, {
      sku: 'atlas-odyssey-pro',
      clientId: site.clientId,
      nameKo: '프로',
      nameEn: 'Pro',
      kind: 'subscription',
      interval: 'month',
      prices: [{ currency: 'KRW', amount: 5000 }],
    });
    await ctx.db.execute(sql`
      insert into subscription (user_id, product_id, payment_method_id, status,
                                current_period_start, current_period_end)
      select pm.user_id, p.id, pm.id, 'active', now(), now() + interval '1 month'
      from payment_method pm, product p`);

    const res = await ctx.send('DELETE', `/v1/payment-methods/${card!.id}`);

    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('conflict');
    expect(calls(ctx.toss, 'deleteBillingKey')).toEqual([]);
  });

  it('FR-53 keeps the card when Toss cannot remove the billing key', async () => {
    const ctx = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await ctx.register();
    const [card] = (await ctx.list()).items;
    ctx.toss.willThrow();

    const res = await ctx.send('DELETE', `/v1/payment-methods/${card!.id}`);

    expect(res.status).toBe(502);
    expect((await ctx.list()).items).toHaveLength(1);
  });

  it('FR-53 answers 404 for another user’s card or an unknown one', async () => {
    const ctx = await setup();
    await ctx.register();
    const [card] = (await ctx.list()).items;
    const other = await signUp(ctx.app);

    const theirs = await ctx.app.request(`/v1/payment-methods/${card!.id}`, {
      method: 'DELETE',
      headers: { cookie: other.cookie, origin: ACCOUNT_URL },
    });
    const unknown = await ctx.send('DELETE', `/v1/payment-methods/${crypto.randomUUID()}`);

    expect([theirs.status, unknown.status]).toEqual([404, 404]);
    expect(calls(ctx.toss, 'deleteBillingKey')).toEqual([]);
  });
});

describe('PATCH /v1/payment-methods/{id}/default', () => {
  it('FR-53 makes another card the default, and only one', async () => {
    const ctx = await setup();
    await ctx.register('auth_1');
    await ctx.register('auth_2');
    const second = (await ctx.list()).items.find((m) => !m.isDefault)!;

    const res = await ctx.send('PATCH', `/v1/payment-methods/${second.id}/default`);

    expect(res.status).toBe(200);
    const { items } = await ctx.list();
    expect(items.filter((m) => m.isDefault).map((m) => m.id)).toEqual([second.id]);
  });
});

describe('who may manage cards', () => {
  it('FR-13 SDD §8 only the account center session, not a token', async () => {
    const ctx = await setup();
    const site = await registerLabs(ctx);
    const userToken = (await signInToSite(ctx, site, ctx.buyer.cookie, { resource: API_URL }))
      .access_token;
    const bearer = (token: string) =>
      ctx.app.request('/v1/payment-methods', { headers: { authorization: `Bearer ${token}` } });

    expect((await bearer(userToken)).status).toBe(401);
    expect((await bearer(await siteToken(ctx, site))).status).toBe(403);
  });
});
