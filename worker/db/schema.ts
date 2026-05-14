import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/* -------------------------------------------------------------------------- */
/*  Users + auth                                                              */
/* -------------------------------------------------------------------------- */

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_uq').on(t.email),
    roleIdx: index('users_role_idx').on(t.role),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expIdx: index('sessions_expires_idx').on(t.expiresAt),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Catalog                                                                   */
/* -------------------------------------------------------------------------- */

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    image: text('image'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({ slugIdx: uniqueIndex('categories_slug_uq').on(t.slug) }),
);

/**
 *  Products: type controls fulfilment behaviour
 *  - key      : assign a license key from `licenseKeys` pool
 *  - file     : grant download via R2 presigned URL (productFiles)
 *  - subscription : assign a key plus an optional renewal window (durationDays)
 *  - script   : alias of file (kept for clarity / search filter)
 */
export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    shortDescription: text('short_description'),
    description: text('description'),
    type: text('type', { enum: ['key', 'file', 'subscription', 'script'] }).notNull().default('key'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),

    /* Pricing — minor units of APP_CURRENCY (USD cents) */
    priceCents: integer('price_cents').notNull(),
    compareAtCents: integer('compare_at_cents'),

    /* Display */
    image: text('image'),
    gallery: text('gallery'), // JSON array
    badge: text('badge'), // hot / new / sale
    rating: integer('rating').notNull().default(0), // 0..50 for half-stars

    /* SEO */
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    keywords: text('keywords'),

    /* Subscription metadata */
    durationDays: integer('duration_days'),

    /* Stock — inferred from license_keys for `key` and `subscription`,
       set manually for `file` / `script` (use 0 for unlimited) */
    manualStock: integer('manual_stock'),

    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isFeatured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
    salesCount: integer('sales_count').notNull().default(0),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    slugIdx: uniqueIndex('products_slug_uq').on(t.slug),
    catIdx: index('products_category_idx').on(t.categoryId),
    activeIdx: index('products_active_idx').on(t.isActive),
    featuredIdx: index('products_featured_idx').on(t.isFeatured),
    typeIdx: index('products_type_idx').on(t.type),
  }),
);

/**
 *  R2 object pointers for downloadable products.
 *  `r2Key` is the object key inside the bucket; on fulfilment we mint
 *  a presigned URL with a short TTL.
 */
export const productFiles = sqliteTable(
  'product_files',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    r2Key: text('r2_key').notNull(),
    sizeBytes: integer('size_bytes'),
    mimeType: text('mime_type'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({ pIdx: index('product_files_product_idx').on(t.productId) }),
);

/**
 *  Pool of license keys. status: available | reserved | sold
 */
export const licenseKeys = sqliteTable(
  'license_keys',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    keyValue: text('key_value').notNull(),
    status: text('status', { enum: ['available', 'reserved', 'sold'] })
      .notNull()
      .default('available'),
    orderItemId: text('order_item_id'),
    soldAt: integer('sold_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    pStatusIdx: index('license_keys_p_status_idx').on(t.productId, t.status),
    keyUq: uniqueIndex('license_keys_value_uq').on(t.keyValue),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Orders                                                                    */
/* -------------------------------------------------------------------------- */

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    orderNumber: text('order_number').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),

    /* Snapshot of contact info — supports guest checkout */
    email: text('email').notNull(),

    status: text('status', {
      enum: ['pending', 'awaiting_payment', 'partial', 'paid', 'fulfilled', 'expired', 'cancelled', 'refunded'],
    })
      .notNull()
      .default('pending'),

    /* Money — minor units of fiat currency */
    currency: text('currency').notNull(), // USD
    subtotalCents: integer('subtotal_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    couponCode: text('coupon_code'),

    /* Crypto payment metadata */
    cryptoCurrency: text('crypto_currency'), // btc, ltc, …
    cryptoUnits: text('crypto_units'), // satoshi, etc.
    cryptoAmount: text('crypto_amount'), // expected minor units (BigInt-safe string)
    cryptoReceived: text('crypto_received').notNull().default('0'),
    cryptoAddress: text('crypto_address'),
    cryptoRate: text('crypto_rate'), // string for decimal accuracy
    paymentTxHash: text('payment_tx_hash'),
    paymentConfirmations: integer('payment_confirmations').notNull().default(0),

    fulfilledAt: integer('fulfilled_at', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    notes: text('notes'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    numIdx: uniqueIndex('orders_number_uq').on(t.orderNumber),
    statusIdx: index('orders_status_idx').on(t.status),
    userIdx: index('orders_user_idx').on(t.userId),
    addrIdx: index('orders_address_idx').on(t.cryptoAddress),
    createdIdx: index('orders_created_idx').on(t.createdAt),
  }),
);

export const orderItems = sqliteTable(
  'order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    productName: text('product_name').notNull(),
    productSlug: text('product_slug').notNull(),
    productType: text('product_type').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    quantity: integer('quantity').notNull().default(1),
    licenseKeyId: text('license_key_id').references(() => licenseKeys.id, { onDelete: 'set null' }),
    deliveredKey: text('delivered_key'),
    durationDays: integer('duration_days'),
  },
  (t) => ({ oIdx: index('order_items_order_idx').on(t.orderId) }),
);

/* -------------------------------------------------------------------------- */
/*  Coupons                                                                   */
/* -------------------------------------------------------------------------- */

export const coupons = sqliteTable(
  'coupons',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    type: text('type', { enum: ['percent', 'fixed'] }).notNull().default('percent'),
    value: integer('value').notNull(), // % (1-100) or cents
    minSubtotalCents: integer('min_subtotal_cents').notNull().default(0),
    maxRedemptions: integer('max_redemptions'),
    redemptions: integer('redemptions').notNull().default(0),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({ codeIdx: uniqueIndex('coupons_code_uq').on(t.code) }),
);

/* -------------------------------------------------------------------------- */
/*  Reviews                                                                   */
/* -------------------------------------------------------------------------- */

export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    rating: integer('rating').notNull(),
    title: text('title'),
    body: text('body'),
    isApproved: integer('is_approved', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    pIdx: index('reviews_product_idx').on(t.productId),
    apIdx: index('reviews_approved_idx').on(t.isApproved),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Audit / events                                                            */
/* -------------------------------------------------------------------------- */

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: text('metadata'),
    ip: text('ip'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({ aIdx: index('audit_action_idx').on(t.action) }),
);

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
