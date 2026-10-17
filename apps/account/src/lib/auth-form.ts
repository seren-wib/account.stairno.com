// Shared by the sign-in and sign-up forms. Pure functions so the browser scripts stay thin.

// FR-17: the OIDC provider sends people here with a signed authorization query (it carries
// `sig`). Handing it back to the API with the credentials resumes the site's sign-in.
export function oauthQuery(search: string): string | undefined {
  const params = new URLSearchParams(search);
  return params.has('sig') && params.has('client_id') ? params.toString() : undefined;
}

// Where the browser goes after the API accepted the credentials: the URL the API answered with
// (resolved on the API host), else the return address the page kept (FR-12).
export function nextLocation(
  body: { url?: string; redirect?: boolean } | null,
  apiUrl: string,
  fallback: string,
): string {
  return body?.url ? new URL(body.url, apiUrl).href : fallback;
}

// FR-17 after sign-up: the new user already has a session, so the site's original authorization
// request can simply run again. The provider's signature fields are not part of that request.
export function resumeAuthorizeUrl(oauth: string, apiUrl: string): string {
  const params = new URLSearchParams(oauth);
  params.delete('sig');
  params.delete('exp');
  return `${apiUrl}/auth/oauth2/authorize?${params}`;
}
