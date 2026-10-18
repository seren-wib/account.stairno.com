// A stand-in for the API and its OIDC provider. Each call is recorded; `routes` maps
// "METHOD path" (no query) to a function that returns [status, body].
export const API = 'https://api.example.test';

export function fakeFetch(routes = {}) {
  const calls = [];
  const all = {
    'GET /auth/.well-known/openid-configuration': () => [
      200,
      {
        issuer: `${API}/auth`,
        authorization_endpoint: `${API}/auth/oauth2/authorize`,
        token_endpoint: `${API}/auth/oauth2/token`,
      },
    ],
    'POST /auth/oauth2/token': (call) =>
      call.form.get('grant_type') === 'client_credentials'
        ? [200, { access_token: `site-token-${calls.length}`, expires_in: 3600 }]
        : [200, { access_token: userToken(), expires_in: 3600, id_token: 'id' }],
    ...routes,
  };
  async function fetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const text = typeof init.body === 'string' ? init.body : init.body?.toString();
    const call = {
      method,
      url,
      path: url.pathname,
      headers,
      json: headers.get('content-type')?.includes('json') ? JSON.parse(text) : undefined,
      form: headers.get('content-type')?.includes('form') ? new URLSearchParams(text) : undefined,
    };
    calls.push(call);
    const route = all[`${method} ${url.pathname}`];
    if (!route) return new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 });
    const [status, body] = route(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  return { fetch, calls };
}

// An unsigned JWT is enough here: the rehearsal site only reads the claims to show them; the API
// is the one that verifies the token.
export function userToken(claims = {}) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    part({ alg: 'EdDSA' }),
    part({ sub: 'user-1', azp: 'client-1', exp: 4_000_000_000, ...claims }),
    'sig',
  ].join('.');
}
