import type { SQL } from 'drizzle-orm';
import type { Auth } from './auth';
import type { Env } from './env';
import type { Mailer } from './mail';
import type { PaymentsMode } from './payments/mode';
import type { PaymentProvider } from './payments/provider';

// The R2 bucket of desktop builds (FR-62), as much of R2's binding as the API uses.
export interface DownloadBucket {
  get(key: string): Promise<{
    body: ReadableStream;
    size: number;
    httpMetadata?: { contentType?: string };
  } | null>;
}

// FR-85: the profile photo bucket, as much of R2's binding as the API uses.
export interface AvatarBucket {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    size: number;
    httpMetadata?: { contentType?: string };
  } | null>;
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>;
  delete(keys: string | string[]): Promise<void>;
}

export interface Deps {
  // Only what the routes need, so tests can pass a PGlite database or a failing stub.
  db: { execute(query: SQL): Promise<unknown> };
  auth: Auth;
  // The API's own public address (API_URL), for links it hands out such as downloads (FR-62).
  apiUrl: string;
  // Browser origins the API answers besides registered sites (FR-26, FR-80).
  origins: { account: string; hub: string };
  // FR-42, read once from PAYMENTS_MODE.
  paymentsMode: PaymentsMode;
  // NFR-13: the only way routes reach a payment provider. Tests pass the fake (NFR-16).
  providers: { toss: PaymentProvider; paypal: PaymentProvider };
  // Encrypts billing keys and derives customerKeys (FR-45, DR-4). Unset means no cards.
  billingKeySecret: string | undefined;
  // Toss's public client key, the pair of TOSS_SECRET_KEY, for the card window (FR-45).
  tossClientKey?: string | undefined;
  // FR-62: the files, and the secret download links are signed with. No bucket, no downloads.
  downloads?: DownloadBucket | undefined;
  downloadSecret: string;
  // FR-85: profile photos. No bucket, no photos.
  avatars?: AvatarBucket | undefined;
  // Payment mails (FR-65, FR-72); the auth mails get the same mailer through createAuth.
  mailer: Mailer;
}

export type AuthSession = Auth['$Infer']['Session'];
export type AuthUser = AuthSession['user'];

// A site's server calling with its own client-credentials token (SDD §8).
export interface SitePrincipal {
  clientId: string;
  // The origins of its redirect URIs: where its pages, and its buyers, may be sent back to.
  origins: string[];
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    deps: Deps;
    // Set for a user caller only; routes that need one mount requireUser.
    user: AuthUser;
    // The account center's cookie session; null when the request came with a Bearer token.
    session: AuthSession['session'] | null;
    // Set for a site caller only; routes that need one mount requireSite.
    site: SitePrincipal | null;
    // The site a user's access token was issued to (its azp); null for the account center's
    // cookie session and for a site's own token (FR-60).
    tokenClient: string | null;
  };
}
