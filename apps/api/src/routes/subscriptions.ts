import { Hono, type Context } from 'hono';
import type { AppEnv } from '../deps';
import { apiError } from '../http/errors';
import { requireCookieSession, requireUser } from '../middleware/session';
import {
  cancelSubscription,
  listUserSubscriptions,
  readUserSubscription,
  resumeSubscription,
  type UserSubscriptionRow,
} from '../payments/subscription-store';

// FR-32, FR-56, UC-8: the account center's subscription list, and cancel and resume. Like the
// cards, only its own cookie session manages them; NFR-5's origin check covers every change.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (value: string | Date) => new Date(value).toISOString();

function subscriptionJson(row: UserSubscriptionRow) {
  return {
    id: row.id,
    sku: row.sku,
    name: { ko: row.name_ko, en: row.name_en },
    status: row.status,
    amount: row.amount,
    // Subscriptions are sold in KRW only (DR-5, FR-46).
    currency: 'KRW',
    interval: row.interval,
    currentPeriodStart: iso(row.current_period_start),
    currentPeriodEnd: iso(row.current_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    card: row.has_card ? { cardCompany: row.card_company, cardLast4: row.card_last4 } : null,
  };
}

async function change(
  c: Context<AppEnv>,
  act: typeof cancelSubscription,
  what: 'cancel' | 'resume',
) {
  const { db } = c.var.deps;
  const id = c.req.param('id') ?? '';
  const input = { userId: c.var.user.id, id };
  const found = UUID.test(id) ? await readUserSubscription(db, input) : undefined;
  if (!found) return apiError(c, 404, 'not_found', 'There is no such subscription.');
  if (!(await act(db, input))) {
    return apiError(c, 409, 'invalid_transition', `A ${found.status} subscription cannot ${what}.`);
  }
  console.info(`subscription ${what}`, { subscriptionId: id });
  return c.json(subscriptionJson((await readUserSubscription(db, input))!));
}

export const subscriptionRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .use(requireCookieSession)
  .get('/', async (c) => {
    const items = await listUserSubscriptions(c.var.deps.db, c.var.user.id);
    // SDD §8 list shape; a user has a handful at most, so one page.
    return c.json({ items: items.map(subscriptionJson), nextCursor: null });
  })
  .post('/:id/cancel', (c) => change(c, cancelSubscription, 'cancel'))
  .post('/:id/resume', (c) => change(c, resumeSubscription, 'resume'));
