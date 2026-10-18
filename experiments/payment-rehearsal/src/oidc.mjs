// The site side of Stairno sign-in (SDD §3): the authorization code flow with PKCE against the
// API's discovery document, and the site's own client_credentials token (FR-35). Both ask for the
// API as the RFC 8707 resource, which makes the access token a JWT the API can verify.

export const USER_SCOPE = 'openid profile email';

export class UpstreamError extends Error {
  constructor(what, status, body) {
    super(`${what} answered ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createOidc({ fetch, now }) {
  let discovery = null;
  let siteToken = null;

  async function discover(env) {
    if (discovery?.apiUrl === env.API_URL) return discovery.document;
    const res = await fetch(`${env.API_URL}/auth/.well-known/openid-configuration`);
    const body = await readJson(res);
    if (!res.ok) throw new UpstreamError('discovery', res.status, body);
    discovery = { apiUrl: env.API_URL, document: body };
    return body;
  }

  async function token(env, form) {
    const { token_endpoint } = await discover(env);
    const res = await fetch(token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      // Registered clients authenticate with client_secret_post (admin/register-client.ts).
      body: new URLSearchParams({
        ...form,
        client_id: env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
        resource: env.API_URL,
      }).toString(),
    });
    const body = await readJson(res);
    if (!res.ok || typeof body?.access_token !== 'string') {
      throw new UpstreamError('token endpoint', res.status, body);
    }
    return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
  }

  return {
    async authorizeUrl(env, { redirectUri, state, challenge }) {
      const { authorization_endpoint } = await discover(env);
      const url = new URL(authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: env.CLIENT_ID,
        redirect_uri: redirectUri,
        scope: USER_SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: env.API_URL,
      }).toString();
      return url.toString();
    },

    exchangeCode(env, { code, verifier, redirectUri }) {
      return token(env, {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
    },

    // One site token per isolate, renewed a minute before it runs out.
    async siteToken(env) {
      if (siteToken && siteToken.clientId === env.CLIENT_ID && siteToken.until > now()) {
        return siteToken.accessToken;
      }
      const fresh = await token(env, { grant_type: 'client_credentials', scope: 'commerce' });
      siteToken = {
        clientId: env.CLIENT_ID,
        accessToken: fresh.accessToken,
        until: now() + (fresh.expiresIn - 60) * 1000,
      };
      return fresh.accessToken;
    },
  };
}

// The claims are only shown on the page; the API is the one that verifies the token.
export function readClaims(jwt) {
  try {
    const part = jwt.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}
