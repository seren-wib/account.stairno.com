import type { SQL } from 'drizzle-orm';
import type { Auth } from './auth';
import type { Env } from './env';
import type { PaymentsMode } from './payments/mode';

export interface Deps {
  // Only what the routes need, so tests can pass a PGlite database or a failing stub.
  db: { execute(query: SQL): Promise<unknown> };
  auth: Auth;
  // Browser origins the API answers besides registered sites (FR-26, FR-80).
  origins: { account: string; hub: string };
  // FR-42, read once from PAYMENTS_MODE.
  paymentsMode: PaymentsMode;
}

export type AuthSession = Auth['$Infer']['Session'];
export type AuthUser = AuthSession['user'];

export interface AppEnv {
  Bindings: Env;
  Variables: {
    deps: Deps;
    user: AuthUser;
    // The account center's cookie session; null when the request came with a Bearer token.
    session: AuthSession['session'] | null;
  };
}
