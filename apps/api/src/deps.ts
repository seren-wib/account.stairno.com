import type { SQL } from 'drizzle-orm';
import type { Auth } from './auth';
import type { Env } from './env';

export interface Deps {
  // Only what the routes need, so tests can pass a PGlite database or a failing stub.
  db: { execute(query: SQL): Promise<unknown> };
  auth: Auth;
}

export type AuthSession = Auth['$Infer']['Session'];

export interface AppEnv {
  Bindings: Env;
  Variables: { deps: Deps; session: AuthSession };
}
