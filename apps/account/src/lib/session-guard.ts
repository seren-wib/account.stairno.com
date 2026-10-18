import type { APIContext, MiddlewareNext } from 'astro';
import { isLocale } from '@stairno/ui/i18n';

// The user as GET /auth/get-session returns it, narrowed to what the pages use.
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  locale: string;
  // FR-84: optional, null until the user picks them.
  country?: string | null;
  timezone?: string | null;
  // FR-85: the public address of the photo, or null.
  image?: string | null;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// Pages anyone can open. Everything else under /{locale}/ needs a session (SRS §6 sitemap).
const PUBLIC_PAGES = new Set([
  'sign-in',
  'sign-up',
  'forgot-password',
  'reset-password',
  'verify-email',
  'terms',
  'privacy',
]);

// The locale of a page that needs sign-in, or null for public pages and non-locale paths.
function protectedLocale(pathname: string): string | null {
  const [, locale = '', page = ''] = pathname.split('/');
  if (!isLocale(locale)) return null;
  return PUBLIC_PAGES.has(page) ? null : locale;
}

async function fetchSessionUser(
  apiUrl: string,
  cookie: string,
  fetchFn: Fetch,
): Promise<SessionUser | null> {
  try {
    // DR-1: the account center never reads the database; it asks the API with the same cookie.
    const res = await fetchFn(`${apiUrl}/auth/get-session`, { headers: { cookie } });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: SessionUser } | null;
    return body?.user ?? null;
  } catch {
    // An unreachable API looks like a signed-out visitor; the sign-in page shows the error.
    return null;
  }
}

// FR-12. A factory so tests can pass a fake fetch; src/middleware.ts wires the real one.
export function createSessionGuard(options: { apiUrl: string; fetch: Fetch }) {
  return async (context: APIContext, next: MiddlewareNext) => {
    context.locals.apiUrl = options.apiUrl;
    const locale = protectedLocale(context.url.pathname);
    if (!locale) return next();

    const cookie = context.request.headers.get('cookie');
    const user = cookie ? await fetchSessionUser(options.apiUrl, cookie, options.fetch) : null;
    if (!user) {
      const back = `${context.url.pathname}${context.url.search}`;
      const query = new URLSearchParams({ redirect: back });
      return context.redirect(`/${locale}/sign-in?${query}`, 302);
    }

    context.locals.user = user;
    return next();
  };
}
