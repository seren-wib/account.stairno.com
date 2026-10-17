// FR-26: an origin is allowed only by exact match, so `http://` on an allowed host, another port
// or a lookalike host never passes.
export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return origin !== '' && allowed.includes(origin);
}

// The origins of sites' redirect URIs: where their pages call the API from.
export function originsOf(urls: readonly string[]): string[] {
  const origins = new Set<string>();
  for (const url of urls) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // A malformed URI cannot be a browser origin.
    }
  }
  return [...origins];
}
