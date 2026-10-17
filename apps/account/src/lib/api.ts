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

// Dates as the page language writes them (UTC, so the server and the reader agree).
export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}
