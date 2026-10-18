// The rehearsal site (test-deploy §8.4). It talks to the production API exactly as a Stairno
// site would: the buyer signs in through OIDC, the site's server holds its own client_credentials
// token, and every commerce call carries the buyer's access token in X-User-Token (FR-35). There
// is no card input anywhere (DR-4): Toss's window takes the card, PayPal its own login.

import { openCookie, pkceChallenge, randomToken, sealCookie } from './crypto.mjs';
import { answer, escapeHtml, form, page, scriptJson, textForm } from './html.mjs';
import { createOidc, readClaims, UpstreamError } from './oidc.mjs';

export const ONE_TIME = 'rehearsal-once';
export const MONTHLY = 'rehearsal-monthly';
export const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';

const REQUIRED = ['API_URL', 'ACCOUNT_URL', 'CLIENT_ID', 'CLIENT_SECRET', 'TOSS_CLIENT_KEY'];
const COOKIE = { oidc: 'rh_oidc', session: 'rh_session', order: 'rh_order' };

// The shop's own test key pair for the payment window (API 개별 연동 키, #159). The shared docs
// keys (test_gck_docs...) pay into another shop, so no webhook would ever reach our API.
const usableTossKey = (key) => typeof key === 'string' && key.startsWith('test_ck_');

// FR-44 rehearsal: what a tampered success redirect would carry instead of the order amount.
export const tamperedAmount = (amount) => (amount > 1 ? Math.floor(amount / 2) : amount + 1);

function readCookies(request) {
  const jar = new Map();
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return jar;
}

const setCookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;

const redirect = (location, status = 302, cookies = []) => {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status, headers });
};

export function createApp({ fetch = globalThis.fetch, now = Date.now } = {}) {
  const oidc = createOidc({ fetch, now });

  async function callApi(env, { method = 'GET', path, bearer, userToken, body }) {
    const headers = { authorization: `Bearer ${bearer}` };
    if (userToken) headers['x-user-token'] = userToken;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${env.API_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON: shown as text
    }
    return { status: res.status, body: parsed };
  }

  const asSite = async (env, call) => callApi(env, { ...call, bearer: await oidc.siteToken(env) });

  async function session(env, jar) {
    const opened = await openCookie(env.CLIENT_SECRET, jar.get(COOKIE.session), { now: now() });
    return opened?.accessToken ? opened : null;
  }

  const signInFirst = () =>
    page('Sign in first', '<p><a href="/sign-in">Sign in with Stairno</a> to do this.</p>', 401);

  async function home(env, jar, origin) {
    const missing = REQUIRED.filter((name) => !env[name]);
    if (missing.some((name) => name !== 'TOSS_CLIENT_KEY')) {
      return page(
        'Not configured',
        `<p>Missing settings: ${missing.map(escapeHtml).join(', ')}. See the README.</p>`,
      );
    }
    const notes = [];
    if (!origin.startsWith('https://')) {
      notes.push('This page is not on https: the API refuses its return addresses.');
    }
    if (!usableTossKey(env.TOSS_CLIENT_KEY)) {
      notes.push('TOSS_CLIENT_KEY is missing or not a test_ck_ key: the Toss window stays closed.');
    }
    const noteHtml = notes.map((note) => `<p><strong>${escapeHtml(note)}</strong></p>`).join('');

    const buyer = await session(env, jar);
    if (!buyer) {
      return page('Payment rehearsal', `${noteHtml}<p><a href="/sign-in">Sign in with Stairno</a></p>`);
    }
    const claims = readClaims(buyer.accessToken) ?? {};
    const lastOrder =
      (await openCookie(env.CLIENT_SECRET, jar.get(COOKIE.order), { now: now() }))?.orderId ?? '';
    const account = env.ACCOUNT_URL;
    return page(
      'Payment rehearsal',
      `${noteHtml}
<p>Signed in as user ${escapeHtml(claims.sub ?? '?')} (token for ${escapeHtml(claims.azp ?? '?')}, until ${escapeHtml(new Date(buyer.exp).toISOString())}).</p>
${form('/sign-out', {}, 'Sign out')}
<h2>One-time purchase: ${ONE_TIME}</h2>
${form('/orders', { sku: ONE_TIME, currency: 'KRW' }, 'Order in KRW (Toss)')}
${form('/orders', { sku: ONE_TIME, currency: 'USD' }, 'Order in USD (PayPal)')}
<h2>Subscription: ${MONTHLY}</h2>
<p>Charged at once on the default card. Add a card first in the <a href="${escapeHtml(account)}/ko/#payment-methods">account center</a>.</p>
${form('/orders', { sku: MONTHLY, currency: 'KRW' }, 'Start the subscription')}
<p>Only the account center may cancel or resume a subscription: <a href="${escapeHtml(account)}/ko/#subscriptions">cancel or resume it there</a>, then look up the entitlement below.</p>
<h2>Look up</h2>
${textForm('/lookup/order', 'orderId', lastOrder, 'Look up the order')}
${form('/lookup/entitlement', { sku: ONE_TIME }, `Entitlement for ${ONE_TIME}`)}
${form('/lookup/entitlement', { sku: MONTHLY }, `Entitlement for ${MONTHLY}`)}
<p>Refund requests, orders and receipts: <a href="${escapeHtml(account)}/ko/">account center</a>.</p>`,
    );
  }

  async function signIn(env, origin) {
    const state = randomToken();
    const verifier = randomToken();
    const location = await oidc.authorizeUrl(env, {
      redirectUri: `${origin}/callback`,
      state,
      challenge: await pkceChallenge(verifier),
    });
    const sealed = await sealCookie(env.CLIENT_SECRET, { state, verifier }, { now: now(), maxAge: 600 });
    return redirect(location, 302, [setCookie(COOKIE.oidc, sealed, 600)]);
  }

  async function callback(env, jar, origin, query) {
    if (query.get('error')) {
      return page('Sign-in failed', `<p>${escapeHtml(query.get('error'))}</p>`, 400);
    }
    const started = await openCookie(env.CLIENT_SECRET, jar.get(COOKIE.oidc), { now: now() });
    const code = query.get('code');
    if (!started || !code || query.get('state') !== started.state) {
      return page('Sign-in failed', '<p>The sign-in state does not match. Start again.</p>', 400);
    }
    const token = await oidc.exchangeCode(env, {
      code,
      verifier: started.verifier,
      redirectUri: `${origin}/callback`,
    });
    const sealed = await sealCookie(
      env.CLIENT_SECRET,
      { accessToken: token.accessToken },
      { now: now(), maxAge: token.expiresIn },
    );
    return redirect('/', 302, [
      setCookie(COOKIE.session, sealed, token.expiresIn),
      setCookie(COOKIE.oidc, '', 0),
    ]);
  }

  function tossWindow(env, origin, created) {
    const { checkout } = created.body;
    if (!usableTossKey(env.TOSS_CLIENT_KEY)) {
      return page(
        'Toss window not opened',
        `<p>TOSS_CLIENT_KEY must be the shop's own test_ck_ client key, the pair of the API's TOSS_SECRET_KEY. The order stays pending and expires in 30 minutes.</p>${answer('Order', created)}`,
      );
    }
    const data = {
      clientKey: env.TOSS_CLIENT_KEY,
      orderId: checkout.orderId,
      amount: checkout.amount,
      orderName: checkout.orderName,
      successUrl: `${origin}/return/toss`,
      failUrl: `${origin}/return/toss-fail`,
    };
    return page(
      'Pay with Toss',
      `<p>Order ${escapeHtml(checkout.orderId)}: ${escapeHtml(checkout.amount)} ${escapeHtml(checkout.currency)}. Toss's window takes the test card.</p>
<button id="pay" type="button">Open the Toss payment window</button>
<p id="result"></p>
${answer('Order', created)}
<script type="application/json" id="checkout">${scriptJson(data)}</script>
<script src="${TOSS_SDK_URL}"></script>
<script>
const data = JSON.parse(document.getElementById('checkout').textContent);
document.getElementById('pay').addEventListener('click', async () => {
  try {
    const payment = TossPayments(data.clientKey).payment({ customerKey: TossPayments.ANONYMOUS });
    await payment.requestPayment({
      method: 'CARD',
      amount: { currency: 'KRW', value: data.amount },
      orderId: data.orderId,
      orderName: data.orderName,
      successUrl: data.successUrl,
      failUrl: data.failUrl,
    });
  } catch (error) {
    document.getElementById('result').textContent =
      (error && error.code ? error.code + ': ' : '') + ((error && error.message) || error);
  }
});
</script>`,
    );
  }

  async function order(env, buyer, origin, fields) {
    const sku = fields.get('sku') ?? '';
    const currency = fields.get('currency') ?? '';
    const created = await asSite(env, {
      method: 'POST',
      path: '/v1/orders',
      userToken: buyer.accessToken,
      body: {
        sku,
        currency,
        returnUrl: `${origin}/return/${currency === 'USD' ? 'paypal' : 'toss'}`,
      },
    });
    const checkout = created.status === 201 ? created.body?.checkout : null;
    const remember = checkout
      ? [
          setCookie(
            COOKIE.order,
            await sealCookie(env.CLIENT_SECRET, { orderId: checkout.orderId }, { now: now(), maxAge: 1800 }),
            1800,
          ),
        ]
      : [];

    if (checkout?.provider === 'toss') {
      const res = tossWindow(env, origin, created);
      for (const cookie of remember) res.headers.append('set-cookie', cookie);
      return res;
    }
    if (checkout?.provider === 'paypal') {
      const paypal = await asSite(env, {
        method: 'POST',
        path: '/v1/payments/paypal/orders',
        body: { orderId: checkout.orderId },
      });
      if (paypal.status === 200 && typeof paypal.body?.approvalUrl === 'string') {
        return redirect(paypal.body.approvalUrl, 303, remember);
      }
      return page('PayPal order not created', answer('Order', created) + answer('PayPal order', paypal));
    }
    // A subscription is charged at once and comes back settled; anything else is the API's answer.
    return page(sku === MONTHLY ? 'Subscription' : 'Order', answer('Order', created));
  }

  function tossReturn(query) {
    const paymentKey = query.get('paymentKey') ?? '';
    const orderId = query.get('orderId') ?? '';
    const amount = Number(query.get('amount'));
    return page(
      'Back from Toss',
      `<p>paymentKey ${escapeHtml(paymentKey)}, orderId ${escapeHtml(orderId)}, amount ${escapeHtml(amount)}.</p>
<h2>Confirm (step 1)</h2>
${form('/confirm/toss', { paymentKey, orderId, amount }, `Confirm with ${amount}`)}
<h2>Confirm with a tampered amount (step 2)</h2>
<p>Sends ${escapeHtml(tamperedAmount(amount))} instead. Expect 422 amount_mismatch and a failed order.</p>
${form('/confirm/toss', { paymentKey, orderId, amount, tamper: '1' }, 'Confirm with the tampered amount')}`,
    );
  }

  async function confirmToss(env, fields) {
    const amount = Number(fields.get('amount'));
    const result = await asSite(env, {
      method: 'POST',
      path: '/v1/payments/toss/confirm',
      body: {
        paymentKey: fields.get('paymentKey') ?? '',
        orderId: fields.get('orderId') ?? '',
        amount: fields.get('tamper') === '1' ? tamperedAmount(amount) : amount,
      },
    });
    return page('Toss confirm', answer('Confirm', result));
  }

  async function paypalReturn(env, jar, query) {
    const orderId =
      (await openCookie(env.CLIENT_SECRET, jar.get(COOKIE.order), { now: now() }))?.orderId ?? '';
    const body = orderId
      ? form('/capture/paypal', { orderId }, `Capture order ${orderId}`)
      : textForm('/capture/paypal', 'orderId', '', 'Capture');
    return page(
      'Back from PayPal',
      `<p>PayPal token ${escapeHtml(query.get('token') ?? '')}${query.get('PayerID') ? ', approved' : ', not approved (canceled?)'}.</p>${body}`,
    );
  }

  async function handle(request, env) {
    const url = new URL(request.url);
    const { origin } = url;
    const jar = readCookies(request);
    const route = `${request.method} ${url.pathname}`;

    if (url.pathname === '/') return home(env, jar, origin);
    if (REQUIRED.some((name) => name !== 'TOSS_CLIENT_KEY' && !env[name])) {
      return page('Not configured', '<p>See the README for the settings.</p>', 503);
    }
    switch (route) {
      case 'GET /sign-in':
        return signIn(env, origin);
      case 'GET /callback':
        return callback(env, jar, origin, url.searchParams);
      case 'GET /return/toss':
        return tossReturn(url.searchParams);
      case 'GET /return/toss-fail':
        return page(
          'Toss window failed',
          `<p>${escapeHtml(url.searchParams.get('code') ?? '')}: ${escapeHtml(url.searchParams.get('message') ?? '')}</p>`,
        );
      case 'GET /return/paypal':
        return paypalReturn(env, jar, url.searchParams);
      case 'POST /sign-out':
        return redirect('/', 303, [setCookie(COOKIE.session, '', 0), setCookie(COOKIE.order, '', 0)]);
    }

    const actions = ['/orders', '/confirm/toss', '/capture/paypal', '/lookup/order', '/lookup/entitlement'];
    if (!actions.includes(url.pathname)) return page('Not found', '', 404);
    if (request.method !== 'POST') return page('Use the buttons', '', 405, { allow: 'POST' });

    const buyer = await session(env, jar);
    if (!buyer) return signInFirst();
    const fields = new URLSearchParams(await request.text());
    switch (url.pathname) {
      case '/orders':
        return order(env, buyer, origin, fields);
      case '/confirm/toss':
        return confirmToss(env, fields);
      case '/capture/paypal': {
        const result = await asSite(env, {
          method: 'POST',
          path: '/v1/payments/paypal/capture',
          body: { orderId: fields.get('orderId') ?? '' },
        });
        return page('PayPal capture', answer('Capture', result));
      }
      case '/lookup/order': {
        const result = await asSite(env, {
          path: `/v1/orders/${encodeURIComponent(fields.get('orderId') ?? '')}`,
        });
        return page('Order', answer('Order', result));
      }
      default: {
        // FR-60: the site asks with its buyer's own access token.
        const result = await callApi(env, {
          path: `/v1/entitlements?${new URLSearchParams({ sku: fields.get('sku') ?? '' })}`,
          bearer: buyer.accessToken,
        });
        return page('Entitlement', answer('Entitlement', result));
      }
    }
  }

  return async function app(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof UpstreamError) {
        return page('Stairno sign-in did not answer', answer(error.message, error), 502);
      }
      // Messages only: no token or secret is ever part of one.
      console.error('rehearsal error', error instanceof Error ? error.message : String(error));
      return page('Something broke', `<p>${escapeHtml(error instanceof Error ? error.message : error)}</p>`, 500);
    }
  };
}
