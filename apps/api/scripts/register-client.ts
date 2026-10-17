// FR-15: register a site as an OIDC client. Runs on the operator's machine against the database
// in DATABASE_URL (Neon in production, the local proxy in development):
//
//   npm run admin:register-client --workspace apps/api -- --name "Stairno Labs" \
//     --redirect-uri https://stairnolabs.com/api/auth/oauth2/callback/stairno
//
// Needs DATABASE_URL, BETTER_AUTH_SECRET, API_URL and ACCOUNT_URL in the environment (the same
// values as the Worker). The operator signs in with their own Stairno account at the prompt;
// the password is not stored. The client secret is printed once: put it in the site's Wrangler
// secrets and nowhere else.
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { registerClient } from '../src/admin/register-client';
import { createAuth } from '../src/auth';
import { createDb } from '../src/db/client';
import { createMailer } from '../src/mail';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    'redirect-uri': { type: 'string', multiple: true },
  },
});
const name = values.name;
const redirectUris = values['redirect-uri'] ?? [];
if (!name || redirectUris.length === 0) {
  console.error('usage: --name <site name> --redirect-uri <https callback> [--redirect-uri ...]');
  process.exit(1);
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`${key} is not set`);
    process.exit(1);
  }
  return value;
}

// One interface read line by line, so answers typed (or piped) ahead are not lost.
const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
const output = rl as unknown as { _writeToOutput?: (s: string) => void };
let muted = false;
// Echo nothing while the password is typed (only a terminal echoes input).
const write = output._writeToOutput?.bind(rl);
if (write) {
  output._writeToOutput = (s) => {
    if (!muted) write(s);
  };
}

async function ask(question: string, hidden = false): Promise<string> {
  stdout.write(question);
  muted = hidden;
  const { value } = await lines.next();
  muted = false;
  if (hidden) stdout.write('\n');
  return String(value ?? '').trim();
}

const auth = createAuth({
  db: createDb(required('DATABASE_URL')),
  apiUrl: required('API_URL'),
  accountUrl: required('ACCOUNT_URL'),
  cookieDomain: process.env.COOKIE_DOMAIN ?? '',
  secret: required('BETTER_AUTH_SECRET'),
  mailer: createMailer({ apiKey: undefined }),
});
await auth.$context;

const email = await ask('Operator email: ');
const password = await ask('Password: ', true);
rl.close();
const signIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
if (!signIn.ok) {
  console.error(`sign-in failed (${signIn.status})`);
  process.exit(1);
}
const cookie = signIn.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');

const client = await registerClient(auth, { name, redirectUris }, new Headers({ cookie }));
await auth.api.signOut({ headers: new Headers({ cookie }) });

console.log(`client_id     ${client.clientId}`);
console.log(`client_secret ${client.clientSecret}`);
console.log('Shown once. Store it as a Wrangler secret of the site.');
