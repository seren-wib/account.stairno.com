import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { jwt } from 'better-auth/plugins/jwt';
import { oauthProvider } from '@better-auth/oauth-provider';
import { localeSchema, termsVersion, termsVersionSchema } from '@stairno-account/contract';
import * as schema from './db/schema';
import { mailLog } from './db/schema';
import { renderMail, resolveLocale, type Mailer, type TemplateName } from './mail';
import { ProviderError } from './payments/provider';

export interface AuthConfig {
  // Drizzle database (neon-http in Workers, PGlite in tests). Typed loosely so both fit.
  db: Parameters<typeof drizzleAdapter>[0];
  apiUrl: string;
  accountUrl: string;
  // The hub stairno.com: its account menu reads the session and signs out from the browser (FR-80).
  hubUrl: string;
  cookieDomain: string;
  secret: string;
  mailer: Mailer;
  // FR-8: runs after the password check and before the user is deleted; a throw stops it.
  beforeDeleteUser?: (userId: string) => Promise<void>;
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

// FR-18: sites read who signed in straight from the ID token. Better Auth leaves the standard
// claims to userinfo unless the `claims` parameter asks for them, so they are added here by scope.
// `locale` is the standard profile claim (FR-78).
function idTokenClaims({
  user,
  scopes,
}: {
  user: { email: string; emailVerified: boolean; name: string } & Record<string, unknown>;
  scopes: string[];
}) {
  return {
    ...(scopes.includes('email') ? { email: user.email, email_verified: user.emailVerified } : {}),
    ...(scopes.includes('profile') ? { name: user.name, locale: user.locale } : {}),
  };
}

// SDD §4. One factory so the Worker, the tests and the schema generator build the same instance.
export function createAuth(config: AuthConfig) {
  const secure = config.apiUrl.startsWith('https://');

  // Auth mails link to an account center page in the user's language, which hands the token
  // to the API (SDD §7.3). The user object carries the additional `locale` field.
  async function sendAuthMail(
    template: TemplateName,
    page: string,
    user: { id: string; email: string; name: string },
    token: string,
  ) {
    const locale = resolveLocale((user as { locale?: string }).locale);
    const url = `${config.accountUrl}/${locale}/${page}?token=${encodeURIComponent(token)}`;
    const entry = { userId: user.id, template, locale, to: user.email };
    // FR-74: a failed send never fails the request. It is recorded, and the user can ask again.
    try {
      const sent = await config.mailer.send({
        to: user.email,
        ...renderMail(template, locale, { name: user.name, url }),
      });
      await config.db.insert(mailLog).values({
        ...entry,
        status: sent?.skipped ? 'skipped' : 'sent',
        providerId: sent?.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('mail failed', { template, error: message });
      await config.db.insert(mailLog).values({ ...entry, status: 'failed', error: message });
    }
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
      // FR-8: deleted at once, no confirmation mail. Billing keys are removed at the provider
      // first; when it cannot be reached the deletion waits for the next try (502).
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          try {
            await config.beforeDeleteUser?.(user.id);
          } catch (error) {
            if (!(error instanceof ProviderError)) throw error;
            throw new APIError('BAD_GATEWAY', {
              code: 'PROVIDER_ERROR',
              message: 'A card could not be removed at the payment provider. Please try again.',
            });
          }
        },
      },
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
    // NFR-4, FR-74: per client IP and path, in the database so every Worker isolate sees one count.
    // Better Auth has no per-account limit; the Cloudflare WAF rule covers bursts (SDD §9).
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/*': { window: 60, max: 10 },
        '/sign-up/*': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 1 },
        // The account center's server asks on every page, all from one egress address.
        '/get-session': false,
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      cookiePrefix: 'stairno',
      useSecureCookies: secure,
      crossSubDomainCookies: config.cookieDomain
        ? { enabled: true, domain: config.cookieDomain }
        : { enabled: false },
      database: { generateId: 'uuid' },
      // NFR-5: Better Auth switches its origin check off when it detects a test run. Pinning it
      // on makes the tests refuse foreign and missing origins exactly as production does.
      disableOriginCheck: false,
    },
    // NFR-5: state-changing requests from these origins pass the origin check. CORS decides which
    // paths each may read (middleware/cors.ts); the hub only gets get-session and sign-out.
    trustedOrigins: [config.accountUrl, config.hubUrl],
    // FR-15: sites are managed by the admin command only, which calls these server-side.
    // Over HTTP any signed-in user would reach them, so they are closed there.
    disabledPaths: [
      '/oauth2/create-client',
      '/oauth2/get-client',
      '/oauth2/get-clients',
      '/oauth2/update-client',
      '/oauth2/delete-client',
      '/oauth2/client/rotate-secret',
    ],
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
        // FR-83: a new password ends every other session, as a reset does (FR-5), whatever the
        // client sends. Better Auth then opens a fresh session for this browser.
        if (ctx.path === '/change-password' && ctx.body) {
          return { context: { ...ctx, body: { ...ctx.body, revokeOtherSessions: true } } };
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
        // Site clients belong to Stairno, not to the operator who registered them, so deleting
        // that operator's account (FR-8) leaves the sites alone.
        clientReference: () => 'stairno',
        // Client changes reach the provider only from the admin command: the HTTP routes for them
        // are in disabledPaths and dynamic registration is off. The provider still asks for this
        // hook before it lets a client have client-credentials scopes (FR-35).
        clientPrivileges: () => true,
        // `commerce` is for sites' own client-credentials tokens (FR-35), never for a user.
        scopes: ['openid', 'profile', 'email', 'offline_access', 'commerce'],
        resources: [config.apiUrl],
        enforcePerClientResources: false,
        // FR-19: one hour, stated here rather than left to the library default.
        accessTokenExpiresIn: 60 * 60,
        // FR-20: 90 days (the default is 30). Reuse interval stays 0: any reuse of a rotated
        // refresh token is a replay and is refused.
        refreshTokenExpiresIn: 60 * 60 * 24 * 90,
        customIdTokenClaims: idTokenClaims,
        customUserInfoClaims: ({ user, scopes }) =>
          scopes.includes('profile') ? { locale: user.locale } : {},
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
