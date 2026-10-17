// Entry point for the Better Auth CLI only: `npm run auth:schema` regenerates
// src/db/schema/auth.ts from the same options the Worker uses.
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { createAuth } from './src/auth';
import { createMailer } from './src/mail';

export const auth = createAuth({
  db: drizzle(neon('postgres://schema:schema@localhost/schema')),
  apiUrl: 'https://api.stairno.com',
  accountUrl: 'https://account.stairno.com',
  cookieDomain: 'stairno.com',
  secret: 'schema-generation-only-secret-0123456789abcdef',
  mailer: createMailer({ apiKey: undefined }),
});
