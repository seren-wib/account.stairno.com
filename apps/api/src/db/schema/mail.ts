import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { order } from './commerce';

// FR-74: one row per mail. The address lives here and nowhere in the logs (NFR-21); the rows go
// with the account (FR-8). A payment mail names its order, and an order gets each kind of mail
// once (FR-65, FR-72): the row is claimed before the mail is sent.
export const mailLog = pgTable(
  'mail_log',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    template: text('template').notNull(),
    locale: text('locale').notNull(),
    to: text('to').notNull(),
    // 'pending' while a payment mail is being sent, then 'sent', 'failed', or 'skipped' when no
    // mail provider is configured
    status: text('status').notNull(),
    providerId: text('provider_id'),
    error: text('error'),
    orderId: uuid('order_id').references(() => order.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mail_log_order_template_uidx')
      .on(table.orderId, table.template)
      .where(sql`${table.orderId} is not null`),
  ],
);
