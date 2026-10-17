import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

// FR-74: one row per auth mail. The address lives here and nowhere in the logs (NFR-21); the rows
// go with the account (FR-8).
export const mailLog = pgTable('mail_log', {
  id: uuid('id')
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
  template: text('template').notNull(),
  locale: text('locale').notNull(),
  to: text('to').notNull(),
  // 'sent' or 'failed'
  status: text('status').notNull(),
  providerId: text('provider_id'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
