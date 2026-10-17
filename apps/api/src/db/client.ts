import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// The local Neon HTTP proxy (e2e/compose.yml, for `npm run dev` and e2e) answers on
// db.localtest.me:4444 over plain HTTP.
// Production hosts keep the driver default (https, port 443).
const LOCAL_HOST = 'db.localtest.me';
neonConfig.fetchEndpoint = (host) =>
  host === LOCAL_HOST ? `http://${host}:4444/sql` : `https://${host}/sql`;

export function createDb(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema });
}

export type Database = ReturnType<typeof createDb>;
