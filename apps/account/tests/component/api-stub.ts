import { vi } from 'vitest';

// A fake API for pages that read several lists at once: each path answers with its own status
// and body, anything else with an empty list. Paths are matched without the query string.
export function stubApi(
  routes: Record<string, [status: number, body: unknown]>,
  fallback: [status: number, body: unknown] = [200, { items: [], nextCursor: null }],
) {
  const api = vi.fn(async (url: string, _init?: RequestInit) => {
    const [status, body] = routes[new URL(url).pathname] ?? fallback;
    return Response.json(body, { status });
  });
  vi.stubGlobal('fetch', api);
  return api;
}

// The call the page made for one path, to check the URL and the cookie it sent.
export function callTo(api: ReturnType<typeof stubApi>, path: string) {
  return api.mock.calls.find(([url]) => new URL(url).pathname === path);
}
