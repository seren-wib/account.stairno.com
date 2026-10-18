// Server-side reads from the API for account pages. The visitor's Cookie header goes along as it
// came in, so the API sees the same session; the account center never reads the database (DR-1).
export async function apiGet<T>(
  locals: App.Locals,
  request: Request,
  path: string,
): Promise<T | null> {
  try {
    const res = await fetch(`${locals.apiUrl}${path}`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// Dates as the page language writes them, in the user's time zone when one is set (FR-84), else
// UTC so the server and the reader agree. A zone the runtime does not know falls back to UTC.
export function formatDate(iso: string, locale: string, timeZone?: string | null): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeZone: timeZone || 'UTC',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  }
}
