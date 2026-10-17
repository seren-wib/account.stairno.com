import { defineConfig } from 'drizzle-kit';

// drizzle-kit talks to the database over TCP with the `postgres` driver (migrate needs a
// direct connection); the Worker itself uses the Neon HTTP driver in src/db/client.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
