import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { jwt } from 'better-auth/plugins/jwt';
import { oauthProvider } from '@better-auth/oauth-provider';
import * as schema from './db/schema';

export interface AuthConfig {
  // Drizzle database (neon-http in Workers, PGlite in tests). Typed loosely so both fit.
  db: Parameters<typeof drizzleAdapter>[0];
  apiUrl: string;
  accountUrl: string;
  cookieDomain: string;
  secret: string;
}

// SDD §4. One factory so the Worker, the tests and the schema generator build the same instance.
export function createAuth(config: AuthConfig) {
  const secure = config.apiUrl.startsWith('https://');
  return betterAuth({
    baseURL: config.apiUrl,
    basePath: '/auth',
    secret: config.secret,
    database: drizzleAdapter(config.db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        locale: { type: 'string', defaultValue: 'ko' },
        termsVersion: { type: 'string', required: false },
        termsAcceptedAt: { type: 'date', required: false },
      },
    },
    advanced: {
      cookiePrefix: 'stairno',
      useSecureCookies: secure,
      crossSubDomainCookies: config.cookieDomain
        ? { enabled: true, domain: config.cookieDomain }
        : { enabled: false },
      database: { generateId: 'uuid' },
    },
    trustedOrigins: [config.accountUrl],
    plugins: [
      // FR-1: rejects breached passwords on sign-up, change and reset. Sends only the first
      // five hex characters of the SHA-1 hash to api.pwnedpasswords.com.
      haveIBeenPwned(),
      jwt({ jwks: { keyPairConfig: { alg: 'EdDSA' } } }),
      oauthProvider({
        loginPage: `${config.accountUrl}/sign-in`,
        consentPage: `${config.accountUrl}/consent`,
        allowDynamicClientRegistration: false,
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        resources: [config.apiUrl],
        enforcePerClientResources: false,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
