import type { Auth } from '../auth';

export interface ClientInput {
  // Shown nowhere yet; the operator's label for the site.
  name: string;
  // The site's OIDC callback URLs, https only.
  redirectUris: string[];
}

// FR-15, SDD §4. Sites are first-party: no consent screen (FR-16), a server-side secret sent in the
// token request body, PKCE always, refresh tokens (FR-20) and client credentials for server calls
// such as creating orders (FR-35). `headers` must carry a signed-in operator session: Better Auth's
// admin endpoint asks for one even though the client ends up owned by Stairno, not the operator.
export async function registerClient(auth: Auth, input: ClientInput, headers: Headers) {
  const client = await auth.api.adminCreateOAuthClient({
    headers,
    body: {
      client_name: input.name,
      redirect_uris: input.redirectUris,
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token', 'client_credentials'],
      // Without a scope here the provider refuses the client-credentials grant.
      client_credentials_scopes: ['commerce'],
      response_types: ['code'],
      skip_consent: true,
      require_pkce: true,
    },
  });
  if (!client.client_secret) throw new Error('the provider returned no client secret');
  return { clientId: client.client_id, clientSecret: client.client_secret };
}
