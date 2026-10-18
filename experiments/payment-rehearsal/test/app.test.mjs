import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { pkceChallenge } from '../src/crypto.mjs';
import { API, fakeFetch } from './fake-fetch.mjs';

const SITE = 'https://rehearsal.example.workers.dev';
const ORDER_ID = '0b7c4d2e-5f6a-4b8c-9d0e-1f2a3b4c5d6e';
const ENV = {
  API_URL: API,
  ACCOUNT_URL: 'https://account.example.test',
  CLIENT_ID: 'client-1',
  CLIENT_SECRET: 'the-client-secret-that-must-never-reach-a-page-0123456789',
  TOSS_CLIENT_KEY: 'test_ck_shop',
};

function request(path, { method = 'GET', form, cookie } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (form) headers.set('content-type', 'application/x-www-form-urlencoded');
  return new Request(`${SITE}${path}`, {
    method,
    headers,
    body: form ? new URLSearchParams(form).toString() : undefined,
    redirect: 'manual',
  });
}

const cookiesOf = (res) =>
  res.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');

// Signs in through the app itself and returns the cookie header a browser would send next.
async function signIn(app, env = ENV) {
  const start = await app(request('/sign-in'), env);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const back = await app(
    request(`/callback?code=the-code&state=${state}`, { cookie: cookiesOf(start) }),
    env,
  );
  return cookiesOf(back);
}

const order = (status = 'pending', extra = {}) => ({
  id: ORDER_ID,
  status,
  sku: 'rehearsal-once',
  currency: 'KRW',
  amount: 1000,
  provider: 'toss',
  ...extra,
});

test('the home page lists the missing settings and has no sign-in link without them', async () => {
  const { fetch, calls } = fakeFetch();
  const res = await createApp({ fetch })(request('/'), { API_URL: API });
  const html = await res.text();
  assert.equal(res.status, 200);
  for (const name of ['CLIENT_ID', 'CLIENT_SECRET', 'TOSS_CLIENT_KEY']) assert.match(html, new RegExp(name));
  assert.doesNotMatch(html, /href="\/sign-in"/);
  assert.equal(calls.length, 0);
});

test('signed out, the home page offers sign-in and no order buttons', async () => {
  const { fetch } = fakeFetch();
  const html = await (await createApp({ fetch })(request('/'), ENV)).text();
  assert.match(html, /action="\/sign-in"|href="\/sign-in"/);
  assert.doesNotMatch(html, /action="\/orders"/);
  assert.doesNotMatch(html, new RegExp(ENV.CLIENT_SECRET));
});

test('sign-in goes to the provider with PKCE S256, a state and the API as resource', async () => {
  const { fetch } = fakeFetch();
  const res = await createApp({ fetch })(request('/sign-in'), ENV);
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location'));
  assert.equal(`${to.origin}${to.pathname}`, `${API}/auth/oauth2/authorize`);
  const q = to.searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('client_id'), 'client-1');
  assert.equal(q.get('redirect_uri'), `${SITE}/callback`);
  assert.equal(q.get('scope'), 'openid profile email');
  assert.equal(q.get('resource'), API);
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.match(q.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(q.get('state'), /^[A-Za-z0-9_-]{43}$/);
  const cookie = res.headers.getSetCookie()[0];
  assert.match(cookie, /^rh_oidc=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, new RegExp(q.get('state')));
});

test('the callback trades the code with the verifier, the client secret and the resource', async () => {
  const { fetch, calls } = fakeFetch();
  const app = createApp({ fetch });
  const start = await app(request('/sign-in'), ENV);
  const authorize = new URL(start.headers.get('location')).searchParams;
  const back = await app(
    request(`/callback?code=the-code&state=${authorize.get('state')}`, {
      cookie: cookiesOf(start),
    }),
    ENV,
  );
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), '/');
  const token = calls.find((c) => c.path === '/auth/oauth2/token');
  assert.equal(token.form.get('grant_type'), 'authorization_code');
  assert.equal(token.form.get('code'), 'the-code');
  assert.equal(token.form.get('redirect_uri'), `${SITE}/callback`);
  assert.equal(token.form.get('client_id'), 'client-1');
  assert.equal(token.form.get('client_secret'), ENV.CLIENT_SECRET);
  assert.equal(token.form.get('resource'), API);
  assert.equal(await pkceChallenge(token.form.get('code_verifier')), authorize.get('code_challenge'));
  assert.match(cookiesOf(back), /rh_session=/);

  const home = await (await app(request('/', { cookie: cookiesOf(back) }), ENV)).text();
  assert.match(home, /user-1/);
  assert.match(home, /action="\/orders"/);
});

test('a callback with another state, or without the sign-in cookie, trades nothing', async () => {
  const { fetch, calls } = fakeFetch();
  const app = createApp({ fetch });
  const start = await app(request('/sign-in'), ENV);
  const wrong = await app(
    request('/callback?code=c&state=another', { cookie: cookiesOf(start) }),
    ENV,
  );
  assert.equal(wrong.status, 400);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const noCookie = await app(request(`/callback?code=c&state=${state}`), ENV);
  assert.equal(noCookie.status, 400);
  assert.equal(calls.filter((c) => c.path === '/auth/oauth2/token').length, 0);
});

test('a provider error on the callback is shown, not traded', async () => {
  const { fetch, calls } = fakeFetch();
  const res = await createApp({ fetch })(request('/callback?error=access_denied'), ENV);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /access_denied/);
  assert.equal(calls.length, 0);
});

test('ordering needs a signed-in buyer', async () => {
  const { fetch, calls } = fakeFetch();
  const res = await createApp({ fetch })(
    request('/orders', { method: 'POST', form: { sku: 'rehearsal-once', currency: 'KRW' } }),
    ENV,
  );
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('a KRW order is created with the site token and the buyer token, then opens Toss', async () => {
  const { fetch, calls } = fakeFetch({
    'POST /v1/orders': () => [
      201,
      {
        order: order(),
        checkout: {
          provider: 'toss',
          orderId: ORDER_ID,
          amount: 1000,
          currency: 'KRW',
          orderName: '리허설 </script><b>',
        },
      },
    ],
  });
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  const res = await app(
    request('/orders', { method: 'POST', cookie, form: { sku: 'rehearsal-once', currency: 'KRW' } }),
    ENV,
  );
  const html = await res.text();
  assert.equal(res.status, 200);

  const site = calls.find((c) => c.form?.get('grant_type') === 'client_credentials');
  assert.equal(site.form.get('scope'), 'commerce');
  assert.equal(site.form.get('resource'), API);
  assert.equal(site.form.get('client_id'), 'client-1');
  assert.equal(site.form.get('client_secret'), ENV.CLIENT_SECRET);

  const create = calls.find((c) => c.path === '/v1/orders');
  assert.match(create.headers.get('authorization'), /^Bearer site-token-/);
  assert.equal(create.headers.get('x-user-token').split('.').length, 3);
  assert.deepEqual(create.json, {
    sku: 'rehearsal-once',
    currency: 'KRW',
    returnUrl: `${SITE}/return/toss`,
  });

  assert.match(html, /<script src="https:\/\/js\.tosspayments\.com\/v2\/standard"><\/script>/);
  assert.match(html, /test_ck_shop/);
  assert.match(html, new RegExp(ORDER_ID));
  assert.match(html, new RegExp(`${SITE}/return/toss`.replaceAll('/', '\\\\?/')));
  // The order name cannot end the inline script.
  assert.doesNotMatch(html, /리허설 <\/script>/);
  assert.doesNotMatch(html, new RegExp(ENV.CLIENT_SECRET));
});

test('the site token is reused until it is about to run out', async () => {
  let now = 1_000_000;
  const { fetch, calls } = fakeFetch({ ['GET /v1/orders/' + ORDER_ID]: () => [200, order()] });
  const app = createApp({ fetch, now: () => now });
  const cookie = await signIn(app);
  const look = () =>
    app(request('/lookup/order', { method: 'POST', cookie, form: { orderId: ORDER_ID } }), ENV);
  await look();
  await look();
  const siteTokens = () => calls.filter((c) => c.form?.get('grant_type') === 'client_credentials');
  assert.equal(siteTokens().length, 1);
  now += 3_550_000;
  await look();
  assert.equal(siteTokens().length, 2);
});

test('the Toss window refuses the shared docs keys and anything but a test API key', async () => {
  for (const key of ['test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm', 'live_ck_shop', 'test_gck_shop']) {
    const { fetch } = fakeFetch({
      'POST /v1/orders': () => [
        201,
        { order: order(), checkout: { provider: 'toss', orderId: ORDER_ID, amount: 1000, currency: 'KRW', orderName: 'x' } },
      ],
    });
    const app = createApp({ fetch });
    const env = { ...ENV, TOSS_CLIENT_KEY: key };
    const cookie = await signIn(app, env);
    const html = await (
      await app(
        request('/orders', { method: 'POST', cookie, form: { sku: 'rehearsal-once', currency: 'KRW' } }),
        env,
      )
    ).text();
    assert.doesNotMatch(html, /js\.tosspayments\.com/, key);
    assert.match(html, /test_ck_/, key);
  }
});

test('a USD order gets its PayPal order and sends the buyer to PayPal', async () => {
  const { fetch, calls } = fakeFetch({
    'POST /v1/orders': () => [
      201,
      { order: order('pending', { currency: 'USD', provider: 'paypal' }), checkout: { provider: 'paypal', orderId: ORDER_ID, amount: 100, currency: 'USD', orderName: 'x' } },
    ],
    'POST /v1/payments/paypal/orders': () => [
      200,
      { orderId: ORDER_ID, paypalOrderId: 'PP-1', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PP-1' },
    ],
  });
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  const res = await app(
    request('/orders', { method: 'POST', cookie, form: { sku: 'rehearsal-once', currency: 'USD' } }),
    ENV,
  );
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://www.sandbox.paypal.com/checkoutnow?token=PP-1');
  assert.equal(calls.find((c) => c.path === '/v1/orders').json.returnUrl, `${SITE}/return/paypal`);
  const paypal = calls.find((c) => c.path === '/v1/payments/paypal/orders');
  assert.deepEqual(paypal.json, { orderId: ORDER_ID });
  assert.match(paypal.headers.get('authorization'), /^Bearer site-token-/);

  // Back from PayPal, the capture names our order, kept in a cookie across the round trip.
  const back = await app(
    request('/return/paypal?token=PP-1&PayerID=B1', { cookie: `${cookie}; ${cookiesOf(res)}` }),
    ENV,
  );
  const page = await back.text();
  assert.match(page, /action="\/capture\/paypal"/);
  assert.match(page, new RegExp(ORDER_ID));
});

test('PayPal capture sends our order id with the site token and shows the answer', async () => {
  const { fetch, calls } = fakeFetch({
    'POST /v1/payments/paypal/capture': () => [200, { order: order('fulfilled'), payment: { status: 'done' } }],
  });
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  const res = await app(
    request('/capture/paypal', { method: 'POST', cookie, form: { orderId: ORDER_ID } }),
    ENV,
  );
  assert.match(await res.text(), /fulfilled/);
  const capture = calls.find((c) => c.path === '/v1/payments/paypal/capture');
  assert.deepEqual(capture.json, { orderId: ORDER_ID });
  assert.match(capture.headers.get('authorization'), /^Bearer site-token-/);
});

test('back from Toss, the page offers the confirm and the tampered confirm', async () => {
  const { fetch, calls } = fakeFetch();
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  const res = await app(
    request(`/return/toss?paymentKey=pk_1&orderId=${ORDER_ID}&amount=1000`, { cookie }),
    ENV,
  );
  const html = await res.text();
  assert.equal((html.match(/action="\/confirm\/toss"/g) ?? []).length, 2);
  assert.match(html, /name="tamper" value="1"/);
  assert.equal(calls.filter((c) => c.path.startsWith('/v1/')).length, 0);
});

test('a Toss failure redirect shows its code', async () => {
  const { fetch } = fakeFetch();
  const res = await createApp({ fetch })(
    request('/return/toss-fail?code=PAY_PROCESS_CANCELED&message=%3Cb%3Ex'),
    ENV,
  );
  const html = await res.text();
  assert.match(html, /PAY_PROCESS_CANCELED/);
  assert.match(html, /&lt;b&gt;x/);
});

test('the confirm sends the amount from Toss, the tampered confirm another one', async () => {
  const { fetch, calls } = fakeFetch({
    'POST /v1/payments/toss/confirm': (call) =>
      call.json.amount === 1000
        ? [200, { order: order('fulfilled'), payment: { status: 'done' } }]
        : [422, { error: { code: 'amount_mismatch', message: 'The amount is not the order amount.' } }],
  });
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  const form = { paymentKey: 'pk_1', orderId: ORDER_ID, amount: '1000' };

  const ok = await app(request('/confirm/toss', { method: 'POST', cookie, form }), ENV);
  assert.match(await ok.text(), /fulfilled/);
  const bad = await app(
    request('/confirm/toss', { method: 'POST', cookie, form: { ...form, tamper: '1' } }),
    ENV,
  );
  const badHtml = await bad.text();
  assert.match(badHtml, /422/);
  assert.match(badHtml, /amount_mismatch/);

  const [first, second] = calls.filter((c) => c.path === '/v1/payments/toss/confirm');
  assert.deepEqual(first.json, { paymentKey: 'pk_1', orderId: ORDER_ID, amount: 1000 });
  assert.equal(second.json.paymentKey, 'pk_1');
  assert.notEqual(second.json.amount, 1000);
  assert.ok(Number.isInteger(second.json.amount) && second.json.amount > 0);
  assert.match(first.headers.get('authorization'), /^Bearer site-token-/);
});

test('a subscription order is charged at once and its answer is shown, with links to manage it', async () => {
  const { fetch, calls } = fakeFetch({
    'POST /v1/orders': () => [
      201,
      { order: order('fulfilled', { sku: 'rehearsal-monthly' }), payment: { status: 'done' }, subscription: { id: 's-1', status: 'active' } },
    ],
  });
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  const res = await app(
    request('/orders', { method: 'POST', cookie, form: { sku: 'rehearsal-monthly', currency: 'KRW' } }),
    ENV,
  );
  const html = await res.text();
  assert.match(html, /201/);
  assert.match(html, /active/);
  assert.doesNotMatch(html, /js\.tosspayments\.com/);
  assert.equal(calls.find((c) => c.path === '/v1/orders').json.sku, 'rehearsal-monthly');

  const home = await (await app(request('/', { cookie }), ENV)).text();
  assert.match(home, /href="https:\/\/account\.example\.test\/ko\/#subscriptions"/);
});

test('the entitlement lookup uses the buyer token, the order lookup the site token', async () => {
  const { fetch, calls } = fakeFetch({
    'GET /v1/entitlements': () => [200, { status: 'active' }],
    ['GET /v1/orders/' + ORDER_ID]: () => [200, order('fulfilled')],
  });
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  await app(
    request('/lookup/entitlement', { method: 'POST', cookie, form: { sku: 'rehearsal-once' } }),
    ENV,
  );
  await app(request('/lookup/order', { method: 'POST', cookie, form: { orderId: ORDER_ID } }), ENV);

  const entitlement = calls.find((c) => c.path === '/v1/entitlements');
  assert.equal(entitlement.url.searchParams.get('sku'), 'rehearsal-once');
  assert.equal(entitlement.headers.get('authorization').split('.').length, 3);
  assert.doesNotMatch(entitlement.headers.get('authorization'), /site-token/);
  const lookup = calls.find((c) => c.path === `/v1/orders/${ORDER_ID}`);
  assert.match(lookup.headers.get('authorization'), /^Bearer site-token-/);
});

test('the order lookup keeps the id inside one path segment', async () => {
  const { fetch, calls } = fakeFetch();
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  await app(request('/lookup/order', { method: 'POST', cookie, form: { orderId: '../me' } }), ENV);
  assert.equal(calls.at(-1).url.pathname, '/v1/orders/..%2Fme');
});

test('API answers are escaped on the page', async () => {
  const { fetch } = fakeFetch({
    'GET /v1/entitlements': () => [404, { error: { code: 'not_found', message: '<img src=x onerror=alert(1)>' } }],
  });
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  const html = await (
    await app(request('/lookup/entitlement', { method: 'POST', cookie, form: { sku: 'x' } }), ENV)
  ).text();
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('sign-out clears the session cookie', async () => {
  const { fetch } = fakeFetch();
  const app = createApp({ fetch });
  const cookie = await signIn(app);
  const res = await app(request('/sign-out', { method: 'POST', cookie }), ENV);
  assert.equal(res.status, 303);
  assert.match(res.headers.getSetCookie().join(), /rh_session=; .*Max-Age=0/);
});

test('changes need POST and unknown paths are 404', async () => {
  const { fetch } = fakeFetch();
  const app = createApp({ fetch });
  assert.equal((await app(request('/orders'), ENV)).status, 405);
  assert.equal((await app(request('/confirm/toss'), ENV)).status, 405);
  assert.equal((await app(request('/nope'), ENV)).status, 404);
});
