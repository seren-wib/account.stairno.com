import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../deps';
import { apiError } from '../http/errors';

// FR-42. `test` uses test keys and sandboxes, `live` the real ones (not before business
// registration, roadmap step 9), `off` stops payments and nothing else (NFR-11).
export const paymentsModes = ['test', 'live', 'off'] as const;
export type PaymentsMode = (typeof paymentsModes)[number];

// Anything but an exact mode counts as off: a typo in the Worker's variables stops payments
// instead of taking them in a mode nobody chose.
export function parsePaymentsMode(value: string | undefined): PaymentsMode {
  if ((paymentsModes as readonly string[]).includes(value ?? '')) return value as PaymentsMode;
  console.warn('PAYMENTS_MODE is not test, live or off; payments are off', { value });
  return 'off';
}

// For the routes that take money: creating orders, confirming payments, charging billing keys.
export const requirePayments = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.deps.paymentsMode === 'off') {
    return apiError(c, 503, 'payments_off', 'Payments are paused. Please try again later.');
  }
  await next();
});
