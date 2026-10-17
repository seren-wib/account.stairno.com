# Cross-domain login experiment

Question: can a visitor who signed in on `account.stairno.com` be signed in on a site under a different registrable domain (`stairnolabs.com`, `stairnoworks.com`, ...) with Better Auth, and how?

Answer (2026-10-18): yes, with `account.stairno.com` acting as an OAuth 2.1 / OIDC provider (`@better-auth/oauth-provider`) and each site running its own Better Auth instance that trusts it through `genericOAuth`. Cookies never cross domains; a redirect round trip does. Details and the resulting design are in `docs/specs/sdd.md` §3.

## What runs

| File | Role |
| --- | --- |
| `account.mjs` | Stand-in for account.stairno.com on `http://127.0.0.1:4101`. Better Auth + `jwt` + `oauthProvider`, email and password sign-in, in-memory DB. Declares the shared API as an OAuth resource. |
| `labs.mjs` | Stand-in for stairnolabs.com on `http://localhost:4102`. Separate Better Auth instance, `genericOAuth` pointed at the account server's discovery document, PKCE, scopes `openid profile email offline_access`. |
| `run.mjs` | Drives the flow like a browser with one cookie jar per origin and prints PASS/FAIL per step. |
| `memory-db.mjs` | Builds the plain object the memory adapter needs from the auth schema. |

## Run

```bash
npm ci
npm start
```

Expected: `13/13 checks passed`. Verified with better-auth 1.7.10, @better-auth/oauth-provider 1.7.10, Node 24.

## Findings

- A plain fetch to an auth endpoint gets `{ redirect: true, url }`; a browser navigation gets a 302. The driver handles both.
- `web` clients must register `https` redirect URIs even on loopback, so the experiment registers the client as `native`. Production clients are `web` with `https://stairnolabs.com/api/auth/callback/stairno`.
- `genericOAuth` authenticates at the token endpoint with `client_secret_post`; the client must be registered with that `token_endpoint_auth_method` (the provider default is `client_secret_basic`).
- Access tokens are opaque unless the client asks for a resource (RFC 8707 `resource=` on authorize and token). With one, the access token is a JWT (RS/EdDSA via the `jwt` plugin, verifiable at `/api/auth/jwks`) whose `aud` includes that resource. That is how `api.stairno.com` will verify calls made on a visitor's behalf.
- `skip_consent: true` on a first-party client removes the consent screen; a signed-in visitor goes authorize → callback in one hop with no prompt.
- Without an account session, authorize redirects to `loginPage` with the signed authorization query. When the login page posts the credentials together with that query as `oauth_query`, the sign-in response already points at the Labs callback with a code. No second visit to authorize is needed.
- `offline_access` is required for a refresh token. `openid` gives an `id_token`.
- Each origin keeps its own `better-auth.session_token`; the account cookie is meaningless to Labs and vice versa.
