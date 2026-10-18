// FR-64: decide a refund request. Runs on the operator's machine against the database in
// DATABASE_URL, with the provider keys of the payments mode (test keys only in this repo):
//
//   npm run admin:refund --workspace apps/api -- --order <order id> --reason "Does not start"
//   npm run admin:refund --workspace apps/api -- --order <order id> --reject
//
// Refunding cancels the whole payment at its provider, then records it. Env: DATABASE_URL,
// PAYMENTS_MODE (test when unset), TOSS_SECRET_KEY, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET.
import { parseArgs } from 'node:util';
import { refund, rejectRefund } from '../src/admin/refund';
import { createDb } from '../src/db/client';
import { parsePaymentsMode } from '../src/payments/mode';
import { createPayPalProvider } from '../src/payments/paypal';
import { createTossProvider } from '../src/payments/toss';

const { values } = parseArgs({
  options: {
    order: { type: 'string' },
    reason: { type: 'string' },
    reject: { type: 'boolean', default: false },
  },
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !values.order) {
  console.error('Set DATABASE_URL and pass --order <order id>.');
  process.exit(1);
}
if (!values.reject && !values.reason) {
  console.error('Pass --reason "<why>" to refund, or --reject.');
  process.exit(1);
}

const db = createDb(databaseUrl);
try {
  if (values.reject) {
    const result = await rejectRefund({ db }, { orderId: values.order });
    console.log(result.kind === 'rejected' ? 'request rejected' : 'no open request for the order');
    process.exit(result.kind === 'rejected' ? 0 : 1);
  }
  const mode = parsePaymentsMode(process.env.PAYMENTS_MODE ?? 'test');
  const result = await refund(
    {
      db,
      providers: {
        toss: createTossProvider({ secretKey: process.env.TOSS_SECRET_KEY, mode }),
        paypal: createPayPalProvider({
          clientId: process.env.PAYPAL_CLIENT_ID,
          clientSecret: process.env.PAYPAL_CLIENT_SECRET,
          webhookId: undefined,
          mode,
        }),
      },
    },
    { orderId: values.order, reason: values.reason! },
  );
  if (result.kind === 'refunded') console.log('order refunded');
  else if (result.kind === 'not_found') console.error('no such order');
  else console.error(`nothing to refund: the order is ${result.status}`);
  process.exit(result.kind === 'refunded' ? 0 : 1);
} catch (error) {
  // Drizzle wraps database errors; the cause says what went wrong.
  console.error((error as { cause?: Error }).cause?.message ?? (error as Error).message);
  process.exit(1);
}
