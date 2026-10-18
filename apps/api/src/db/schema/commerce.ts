import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oauthClient, user } from './auth';

// SDD §5, the 2차 data model. Amounts are integers in the currency's smallest unit next to a
// char(3) currency code (DR-9). Status columns are text; the order state machine keeps their
// values (FR-36). A site (`client_id`) is the oauth client that sells the product (FR-40).

const id = () =>
  uuid('id')
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

// FR-34. Registered by an admin command, never by a site.
export const product = pgTable('product', {
  id: id(),
  sku: text('sku').notNull().unique(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClient.clientId),
  nameKo: text('name_ko').notNull(),
  nameEn: text('name_en').notNull(),
  // 'one_time' or 'subscription'
  kind: text('kind').notNull(),
  // 'month' or 'year' for subscriptions, null otherwise
  interval: text('interval'),
  active: boolean('active').default(true).notNull(),
  // R2 object key of the downloadable build (FR-62), null for anything else
  downloadKey: text('download_key'),
  createdAt: createdAt(),
});

// One row per currency a product sells in. KRW goes through Toss, USD through PayPal.
export const productPrice = pgTable(
  'product_price',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id),
    currency: char('currency', { length: 3 }).notNull(),
    amount: integer('amount').notNull(),
  },
  (table) => [
    uniqueIndex('product_price_product_currency_uidx').on(table.productId, table.currency),
  ],
);

// FR-36. Kept for the legal retention period after the account is gone, with `user_id` cut
// (FR-8). The product and the site cannot be removed while an order points at them.
export const order = pgTable(
  'order',
  {
    id: id(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id),
    currency: char('currency', { length: 3 }).notNull(),
    amount: integer('amount').notNull(),
    // 'pending', 'paid', 'fulfilled', 'failed', 'refunded' or 'expired'
    status: text('status').notNull(),
    // 'toss' or 'paypal', decided by the currency when the order is created
    provider: text('provider').notNull(),
    returnUrl: text('return_url').notNull(),
    // The provider's own order, for providers that have one (the PayPal order id, FR-49)
    providerOrderId: text('provider_order_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('order_user_id_idx').on(table.userId),
    index('order_client_id_idx').on(table.clientId),
    // One of our orders per provider order
    uniqueIndex('order_provider_order_uidx')
      .on(table.provider, table.providerOrderId)
      .where(sql`${table.providerOrderId} is not null`),
  ],
);

// FR-38. The unique provider payment key is what makes a repeated confirm idempotent.
export const payment = pgTable(
  'payment',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => order.id),
    provider: text('provider').notNull(),
    providerPaymentKey: text('provider_payment_key').notNull().unique(),
    // 'pending', 'done', 'failed' or 'canceled'
    status: text('status').notNull(),
    // Card company and last four digits, as the provider reports them (DR-4)
    methodSummary: text('method_summary'),
    receiptUrl: text('receipt_url'),
    // The provider's code when it refused the payment, such as REJECT_CARD_PAYMENT
    failureReason: text('failure_reason'),
    // The provider's response as received
    raw: jsonb('raw'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('payment_order_id_idx').on(table.orderId)],
);

// FR-45, FR-53. The billing key is stored encrypted (AES-GCM, key in a secret); the card itself
// never reaches us (DR-4). Removing a card sets `deleted_at` so `customer_key` stays known.
export const paymentMethod = pgTable(
  'payment_method',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // 'toss'
    provider: text('provider').notNull(),
    billingKey: text('billing_key').notNull(),
    // One uuid per user, shared by all of the user's rows (SDD §6.4)
    customerKey: text('customer_key').notNull(),
    cardCompany: text('card_company'),
    cardLast4: text('card_last4'),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('payment_method_user_id_idx').on(table.userId),
    // At most one live default per user
    uniqueIndex('payment_method_user_default_uidx')
      .on(table.userId)
      .where(sql`${table.isDefault} and ${table.deletedAt} is null`),
  ],
);

// FR-55 to FR-57. `last_attempt_on` is the date of the last renewal attempt: the daily cron
// charges a subscription at most once a day.
export const subscription = pgTable(
  'subscription',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id),
    paymentMethodId: uuid('payment_method_id').references(() => paymentMethod.id),
    // 'active', 'past_due', 'canceled' or 'expired'
    status: text('status').notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    retryCount: integer('retry_count').default(0).notNull(),
    lastAttemptOn: date('last_attempt_on'),
    createdAt: createdAt(),
  },
  (table) => [
    index('subscription_user_id_idx').on(table.userId),
    index('subscription_period_end_idx').on(table.currentPeriodEnd),
  ],
);

// FR-59. What a user may use: one row per user and product, from an order or a subscription.
export const entitlement = pgTable(
  'entitlement',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id),
    // 'active' or 'revoked'
    status: text('status').notNull(),
    // null means permanent
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    downloadable: boolean('downloadable').default(false).notNull(),
    sourceOrderId: uuid('source_order_id').references(() => order.id),
    sourceSubscriptionId: uuid('source_subscription_id').references(() => subscription.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex('entitlement_user_product_uidx').on(table.userId, table.productId)],
);

// FR-63. Filed by a site, resolved by an operator command. Retained like the order (FR-8).
export const refundRequest = pgTable(
  'refund_request',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => order.id),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    reason: text('reason').notNull(),
    // 'requested', 'refunded' or 'rejected'
    status: text('status').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [index('refund_request_order_id_idx').on(table.orderId)],
);

// FR-68, FR-69. Every webhook as received, once per provider and event id. Toss sends no event
// id, so the route derives one from the payment key, status and timestamp (SDD §5).
export const webhookEvent = pgTable(
  'webhook_event',
  {
    id: id(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    // 'received', 'processed' or 'failed'
    status: text('status').notNull(),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('webhook_event_provider_event_uidx').on(table.provider, table.eventId)],
);

export const productRelations = relations(product, ({ one, many }) => ({
  site: one(oauthClient, { fields: [product.clientId], references: [oauthClient.clientId] }),
  prices: many(productPrice),
  orders: many(order),
}));

export const productPriceRelations = relations(productPrice, ({ one }) => ({
  product: one(product, { fields: [productPrice.productId], references: [product.id] }),
}));

export const orderRelations = relations(order, ({ one, many }) => ({
  user: one(user, { fields: [order.userId], references: [user.id] }),
  site: one(oauthClient, { fields: [order.clientId], references: [oauthClient.clientId] }),
  product: one(product, { fields: [order.productId], references: [product.id] }),
  payments: many(payment),
  refundRequests: many(refundRequest),
}));

export const paymentRelations = relations(payment, ({ one }) => ({
  order: one(order, { fields: [payment.orderId], references: [order.id] }),
}));

export const paymentMethodRelations = relations(paymentMethod, ({ one, many }) => ({
  user: one(user, { fields: [paymentMethod.userId], references: [user.id] }),
  subscriptions: many(subscription),
}));

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  user: one(user, { fields: [subscription.userId], references: [user.id] }),
  product: one(product, { fields: [subscription.productId], references: [product.id] }),
  paymentMethod: one(paymentMethod, {
    fields: [subscription.paymentMethodId],
    references: [paymentMethod.id],
  }),
}));

export const entitlementRelations = relations(entitlement, ({ one }) => ({
  user: one(user, { fields: [entitlement.userId], references: [user.id] }),
  product: one(product, { fields: [entitlement.productId], references: [product.id] }),
  sourceOrder: one(order, { fields: [entitlement.sourceOrderId], references: [order.id] }),
  sourceSubscription: one(subscription, {
    fields: [entitlement.sourceSubscriptionId],
    references: [subscription.id],
  }),
}));

export const refundRequestRelations = relations(refundRequest, ({ one }) => ({
  order: one(order, { fields: [refundRequest.orderId], references: [order.id] }),
  user: one(user, { fields: [refundRequest.userId], references: [user.id] }),
}));
