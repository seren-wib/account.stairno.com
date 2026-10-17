import { termsVersion } from '@stairno-account/contract';
import { ACCOUNT_URL } from './app';

// Any Hono app; only app.request() is used.
interface App {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export const PASSWORD = 'stairs-and-lanterns-42';

export function newEmail() {
  return `user-${crypto.randomUUID()}@example.com`;
}

// `name=value` pairs from Set-Cookie, ready to send back as a Cookie header.
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

// POST to a Better Auth endpoint from the account center, optionally with a session cookie.
export function post(
  app: App,
  path: string,
  body: unknown = {},
  cookie?: string,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ACCOUNT_URL,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export function get(app: App, path: string, cookie?: string) {
  return app.request(path, { headers: cookie ? { cookie } : {} });
}

export async function signUp(
  app: App,
  { email = newEmail(), password = PASSWORD, ...extra }: Record<string, unknown> = {},
) {
  const res = await post(app, '/auth/sign-up/email', {
    name: 'Test User',
    email,
    password,
    termsVersion,
    ...extra,
  });
  return { res, email: email as string, password: password as string, cookie: cookieFrom(res) };
}

export async function signIn(
  app: App,
  email: string,
  password = PASSWORD,
  headers: Record<string, string> = {},
) {
  const res = await post(app, '/auth/sign-in/email', { email, password }, undefined, headers);
  return { res, cookie: cookieFrom(res) };
}

// The signed-in user for a cookie, or null when the session is gone.
export async function sessionUser(app: App, cookie: string) {
  const res = await get(app, '/auth/get-session', cookie);
  const body = (await res.json()) as { user: Record<string, unknown> } | null;
  return body?.user ?? null;
}
