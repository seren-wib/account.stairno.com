// Drives the whole flow like a browser would, with one cookie jar per origin.
// Usage: node run.mjs
import { createAccount, ACCOUNT_ORIGIN, API_RESOURCE } from "./account.mjs";
import { createLabs, LABS_ORIGIN, PROVIDER_ID, LABS_CALLBACK } from "./labs.mjs";
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

class Jar {
  cookies = new Map();
  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const [k, v] = pair.split("=");
      if (attrs.some((a) => /max-age=0/i.test(a))) this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), v);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  names() {
    return [...this.cookies.keys()];
  }
}

async function go(url, { jar, method = "GET", body, origin, navigate = false } = {}) {
  const headers = {};
  // Better Auth answers a plain fetch with JSON { redirect, url } and a browser navigation with a 302.
  if (navigate) Object.assign(headers, { accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
  if (jar?.cookies.size) headers.cookie = jar.header();
  if (body) headers["content-type"] = "application/json";
  if (origin) headers.origin = origin;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  jar?.store(res);
  return res;
}

// Follow one hop the way a browser would, whichever form the redirect takes.
async function navigate(url, jar) {
  const res = await go(url, { jar, navigate: true });
  let location = res.headers.get("location");
  if (!location && res.headers.get("content-type")?.includes("json")) {
    const data = await res.json();
    if (data?.redirect) location = data.url;
  }
  if (location && !/^https?:/.test(location)) location = new URL(location, url).toString();
  return { res, location: location ?? "" };
}

const account = await createAccount();
const email = `user-${Date.now()}@example.com`;
const password = "correct horse battery staple";

try {
  // 1. A person signs up on the account server. Their session cookie belongs to that origin only.
  const accountJar = new Jar();
  let res = await go(`${ACCOUNT_ORIGIN}/api/auth/sign-up/email`, {
    jar: accountJar,
    method: "POST",
    origin: ACCOUNT_ORIGIN,
    body: { name: "Experiment", email, password },
  });
  check("account: sign-up sets a session cookie", res.ok && accountJar.names().length > 0, accountJar.names().join(","));

  // 2. The account server registers Labs as a trusted first-party OAuth client (server-only admin endpoint).
  const client = await account.auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie: accountJar.header() }),
    body: {
      client_name: "stairnolabs.com",
      redirect_uris: [LABS_CALLBACK],
      // "web" clients must use https redirect URIs even on loopback; the real Labs is https, this experiment is not.
      application_type: "native",
      // genericOAuth sends the secret in the token request body (client_secret_post); register the client to match.
      token_endpoint_auth_method: "client_secret_post",
      skip_consent: true,
    },
  });
  check("account: Labs registered as OAuth client", !!client.client_id && !!client.client_secret, client.client_id);

  // 3. Discovery document is served under the auth base path.
  res = await fetch(`${ACCOUNT_ORIGIN}/api/auth/.well-known/openid-configuration`);
  const discovery = await res.json();
  check(
    "account: OIDC discovery document",
    discovery.authorization_endpoint?.endsWith("/oauth2/authorize") && discovery.jwks_uri?.endsWith("/jwks"),
    `issuer=${discovery.issuer}`,
  );

  const labs = await createLabs({ clientId: client.client_id, clientSecret: client.client_secret });
  try {
    // 4. A visitor on Labs (no cookies anywhere yet in this "browser") clicks "Sign in with Stairno".
    const labsJar = new Jar();
    res = await go(`${LABS_ORIGIN}/api/auth/sign-in/social`, {
      jar: labsJar,
      method: "POST",
      origin: LABS_ORIGIN,
      body: { provider: PROVIDER_ID, callbackURL: `${LABS_ORIGIN}/me` },
    });
    const signIn = await res.json();
    const authorizeUrl = new URL(signIn.url);
    check(
      "labs: sign-in returns the account authorize URL with PKCE",
      authorizeUrl.origin === ACCOUNT_ORIGIN &&
        authorizeUrl.pathname.endsWith("/oauth2/authorize") &&
        authorizeUrl.searchParams.get("code_challenge_method") === "S256",
      `scope=${authorizeUrl.searchParams.get("scope")}`,
    );

    // 5a. Without an account session the authorize endpoint sends the visitor to the login page.
    let { res: _r1, location: loginLocation } = await navigate(authorizeUrl, new Jar());
    check(
      "account: authorize without session redirects to the login page with a signed oauth query",
      loginLocation.startsWith(`${ACCOUNT_ORIGIN}/sign-in?`) && loginLocation.includes("sig="),
      loginLocation.slice(0, 80) + "...",
    );

    // 5a'. A visitor with no account session signs in on the login page the redirect landed on. The page forwards
    //      the signed oauth_query with the credentials, and the plugin resumes the authorization instead of
    //      dropping the visitor on the account home page.
    const freshJar = new Jar();
    const forwarded = new URL(loginLocation).search.slice(1);
    res = await go(`${ACCOUNT_ORIGIN}/api/auth/sign-in/email`, {
      jar: freshJar,
      method: "POST",
      origin: ACCOUNT_ORIGIN,
      body: { email, password, oauth_query: forwarded },
    });
    const resumed = await res.json();
    const resumedUrl = resumed?.url ? new URL(resumed.url, ACCOUNT_ORIGIN) : null;
    check(
      "account: sign-in with the forwarded oauth_query resumes authorization",
      res.ok && freshJar.names().length > 0 && !!resumedUrl && (resumedUrl.pathname.endsWith("/oauth2/authorize") || resumedUrl.pathname.endsWith("/oauth2/continue") || resumedUrl.href.startsWith(LABS_CALLBACK)),
      `-> ${resumedUrl?.pathname}${resumedUrl?.search.slice(0, 40) ?? ""}`,
    );

    // 5b. With the account session (the browser carries it, same origin) authorize issues a code, no consent screen.
    const { location: callbackLocation } = await navigate(authorizeUrl, accountJar);
    const callbackUrl = new URL(callbackLocation);
    check(
      "account: authorize with session redirects straight to the Labs callback with a code",
      callbackUrl.origin + callbackUrl.pathname === LABS_CALLBACK && callbackUrl.searchParams.has("code") && callbackUrl.searchParams.has("state"),
      callbackUrl.pathname,
    );

    // 6. The browser follows the redirect to Labs. Labs exchanges the code and sets its own session cookie.
    const { location: afterLogin } = await navigate(callbackUrl, labsJar);
    check(
      "labs: callback exchanges the code and sets a Labs session cookie",
      afterLogin === `${LABS_ORIGIN}/me` && labsJar.names().some((n) => n.includes("session_token")),
      `-> ${afterLogin}, cookies=${labsJar.names().join(",")}`,
    );

    // 7. Labs now knows the same person, from its own session.
    res = await go(`${LABS_ORIGIN}/api/auth/get-session`, { jar: labsJar });
    const labsSession = await res.json();
    check("labs: get-session returns the account user", labsSession?.user?.email === email, labsSession?.user?.email);

    // 8. The two sessions are separate: each origin only recognises its own cookie.
    res = await go(`${LABS_ORIGIN}/api/auth/get-session`, { jar: accountJar });
    const crossA = await res.json();
    res = await go(`${ACCOUNT_ORIGIN}/api/auth/get-session`, { jar: labsJar });
    const crossB = await res.json();
    check("sessions are per origin (account cookie means nothing to Labs and vice versa)", crossA === null && crossB === null);

    // 9. Labs stored the access token the account server issued. It is a JWT verifiable with the account JWKS,
    //    which is what api.stairno.com would do when Labs calls it on the visitor's behalf.
    const linked = (labs.db.account ?? []).find((a) => a.providerId === PROVIDER_ID);
    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    let verified = null;
    try {
      verified = await jwtVerify(linked.accessToken, jwks, { issuer: discovery.issuer, audience: API_RESOURCE });
    } catch (e) {
      verified = { error: String(e) };
    }
    let claims = {};
    try {
      claims = decodeJwt(linked.accessToken);
    } catch {
      console.log("access token is not a JWT:", String(linked?.accessToken).slice(0, 40), "len", linked?.accessToken?.length, "idToken?", !!linked?.idToken);
    }
    check(
      "labs: stored access token is a JWT signed by the account server, audience = the API",
      !!verified?.payload && claims.sub === linked.accountId,
      `aud=${JSON.stringify(claims.aud)} scope=${claims.scope} exp-iat=${claims.exp - claims.iat}s`,
    );
    check("labs: id_token and refresh token present", !!linked?.idToken && !!linked?.refreshToken);

    // 10. Signing in again from Labs while the account session is alive needs no password: one redirect round trip.
    const secondJar = new Jar();
    res = await go(`${LABS_ORIGIN}/api/auth/sign-in/social`, {
      jar: secondJar,
      method: "POST",
      origin: LABS_ORIGIN,
      body: { provider: PROVIDER_ID, callbackURL: `${LABS_ORIGIN}/me` },
    });
    const again = new URL((await res.json()).url);
    const hop = await navigate(again, accountJar);
    await navigate(hop.location, secondJar);
    res = await go(`${LABS_ORIGIN}/api/auth/get-session`, { jar: secondJar });
    const second = await res.json();
    check("labs: second sign-in reuses the account session (no password prompt)", second?.user?.email === email);
  } finally {
    labs.close();
  }
} finally {
  account.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
