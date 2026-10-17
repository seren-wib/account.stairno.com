import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { jwt } from 'better-auth/plugins/jwt';
import { oauthProvider } from '@better-auth/oauth-provider';
import { localeSchema, termsVersion, termsVersionSchema } from '@stairno-account/contract';
import * as schema from './db/schema';
import { renderMail, resolveLocale, type Mailer, type TemplateName } from './mail';

export interface AuthConfig {
  // Drizzle database (neon-http in Workers, PGlite in tests). Typed loosely so both fit.
  db: Parameters<typeof drizzleAdapter>[0];
  apiUrl: string;
  accountUrl: string;
  cookieDomain: string;
  secret: string;
  mailer: Mailer;
}

// The verification token is a JWT; Better Auth marks the one for a new address with
// requestType 'change-email-verification'. Reading the payload needs no signature check here:
// it only picks the mail template, and GET /auth/verify-email verifies the token itself.
function isEmailChange(token: string): boolean {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    return (
      (JSON.parse(json) as { requestType?: string }).requestType === 'change-email-verification'
    );
  } catch {
    return false;
  }
}

// SDD §4. One factory so the Worker, the tests and the schema generator build the same instance.
export function createAuth(config: AuthConfig) {
  const secure = config.apiUrl.startsWith('https://');

  // Auth mails link to an account center page in the user's language, which hands the token
  // to the API (SDD §7.3). The user object carries the additional `locale` field.
  async function sendAuthMail(
    template: TemplateName,
    page: string,
    user: { email: string; name: string },
    token: string,
  ) {
    const locale = resolveLocale((user as { locale?: string }).locale);
    const url = `${config.accountUrl}/${locale}/${page}?token=${encodeURIComponent(token)}`;
    await config.mailer.send({
      to: user.email,
      ...renderMail(template, locale, { name: user.name, url }),
    });
  }

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
      // FR-5: the link works once for one hour, and resetting ends every session.
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, token }) =>
        sendAuthMail('resetPassword', 'reset-password', user, token),
    },
    emailVerification: {
      // FR-2: unverified users can sign in; orders and cards check emailVerified instead.
      sendOnSignUp: true,
      // Also sends the link for a new address (FR-6); the token says which of the two it is.
      sendVerificationEmail: ({ user, token }) =>
        sendAuthMail(
          isEmailChange(token) ? 'changeEmail' : 'verifyEmail',
          'verify-email',
          user,
          token,
        ),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    user: {
      // FR-6: the new address is verified first; the old one stays until then.
      changeEmail: { enabled: true },
      // FR-8: deleted at once, no confirmation mail. Orders and billing keys join in 2차.
      deleteUser: { enabled: true },
      additionalFields: {
        // FR-78: only the languages the account center and the mails have.
        locale: { type: 'string', defaultValue: 'ko', validator: { input: localeSchema } },
        // FR-9: the client names the version it showed; the server stamps the time.
        termsVersion: {
          type: 'string',
          required: false,
          validator: { input: termsVersionSchema },
        },
        termsAcceptedAt: { type: 'date', required: false, input: false },
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
    databaseHooks: {
      user: {
        create: {
          // Every account comes from sign-up, which the hook above only lets through with the
          // current terms accepted.
          before: async (user) => ({ data: { ...user, termsAcceptedAt: new Date() } }),
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // FR-8: deleting always asks for the password again. Better Auth alone would also
        // accept a session younger than a day without it.
        const body = ctx.body as { password?: unknown; termsVersion?: unknown } | undefined;
        if (ctx.path === '/delete-user' && !body?.password) {
          throw new APIError('BAD_REQUEST', { message: 'Password is required' });
        }
        // FR-9: no account without accepting the current terms.
        if (ctx.path === '/sign-up/email' && body?.termsVersion !== termsVersion) {
          throw new APIError('BAD_REQUEST', { message: 'The current terms must be accepted' });
        }
      }),
    },
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
