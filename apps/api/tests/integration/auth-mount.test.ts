import { describe, expect, it } from 'vitest';
import { API_URL, createTestApp } from '../helpers/app';

describe('Better Auth under /auth', () => {
  it('FR-14 serves the OIDC discovery document with PKCE S256', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/auth/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc.issuer).toBe(`${API_URL}/auth`);
    expect(doc.authorization_endpoint).toBe(`${API_URL}/auth/oauth2/authorize`);
    expect(doc.token_endpoint).toBe(`${API_URL}/auth/oauth2/token`);
    expect(doc.jwks_uri).toBe(`${API_URL}/auth/jwks`);
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('FR-14 serves an EdDSA key set', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/auth/jwks');
    expect(res.status).toBe(200);
    const jwks = (await res.json()) as { keys: { alg: string; kty: string }[] };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ alg: 'EdDSA', kty: 'OKP' });
  });
});
