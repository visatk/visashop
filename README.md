# VisaShop

A production-ready, sell-ready online digital products shop built on Cloudflare Workers
with an integrated React storefront and admin panel.

## Highlights

- **Stack**
  - **Worker**: Cloudflare Workers (single entry, smart-routed) — handles API, webhooks, SEO and SPA shell injection.
  - **DB**: Cloudflare D1 + drizzle-orm (snake_case).
  - **Cache**: Workers KV — product list cache, exchange-rate cache, rate limiter.
  - **Storage**: Cloudflare R2 — downloadable product files; presigned URLs minted via the AWS S3 SDK.
  - **Mail**: Resend (REST).
  - **Crypto payments**: Apirone Wallet v2 + callbacks; auto-fulfilment on `confirmations >= 1`.
- **Storefront** (React 19 + react-router 7 + Tailwind v4)
  - Hero, featured & latest products, categories.
  - Search, filters, sort.
  - Product page with reviews submission.
  - Cart + checkout flow with crypto picker, live USD→crypto quote, coupon support.
  - Order page with QR code, copyable address, polling status, key/file delivery.
  - Account: orders history, profile, password change.
- **Admin panel**
  - Dashboard with revenue tiles, recent orders, low-stock alerts.
  - Products CRUD, license-key pool ingestion, R2 file uploads (presigned PUT).
  - Categories, coupons, reviews moderation, users + role management.
  - Orders list/detail with manual fulfil/cancel/refund.
- **Auto-purchase / fulfilment**
  - On checkout we generate a unique deposit address through Apirone bound to the order via an HMAC-signed callback URL.
  - The `/api/webhooks/apirone` endpoint processes confirmations and atomically fulfills the order, assigns license keys, mints presigned R2 download URLs, and sends a delivery email.
  - Supports BTC, LTC, DOGE, TRX, USDT/USDC on Tron, ETH, USDT/USDC on ETH, BNB.
- **SEO**
  - Server-rewritten `<head>` per route via HTMLRewriter (canonical, OG, Twitter, JSON-LD).
  - Dynamic `/sitemap.xml` and `/robots.txt`.
  - Schema.org `Product` markup with `Offer`, `AggregateRating`, `WebSite` + `ItemList`.
- **Security**
  - PBKDF2-SHA256 (210k iterations) password hashing.
  - HMAC-signed session cookie + server-side D1 sessions table.
  - HMAC-signed payment callback tokens; D1 idempotency on confirmation transitions.
  - Strict security headers (CSP, HSTS, X-Frame-Options, etc.).
  - KV-backed rate limiting on auth + checkout endpoints.
  - Constant-time password comparison; user-enumeration mitigation on login.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Provision Cloudflare resources

```bash
# Create the D1 database
wrangler d1 create visashop_db

# Create the R2 bucket
wrangler r2 bucket create visashop-files

# Create the KV namespace
wrangler kv namespace create visashop_kv
```

Copy the IDs the CLI prints into `wrangler.jsonc` (`d1_databases[0].database_id`,
`kv_namespaces[0].id`, `r2_buckets[0].bucket_name`).

### 3. Apply the migrations + seed (optional)

```bash
npm run db:migrate:local        # apply schema to local dev D1
npm run db:seed:local           # seed sample products
# in production:
npm run db:migrate:remote
npm run db:seed:remote          # optional sample data
```

### 4. Configure secrets

```bash
wrangler secret put SESSION_SECRET           # 32+ random bytes (openssl rand -hex 32)
wrangler secret put WEBHOOK_SECRET           # 32+ random bytes
wrangler secret put APIRONE_WALLET           # e.g. btc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
wrangler secret put APIRONE_TRANSFER_KEY     # only required for outbound transfers
wrangler secret put RESEND_API_KEY           # Resend API key
wrangler secret put R2_ACCESS_KEY_ID         # R2 → Manage R2 API tokens (read+write)
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put ADMIN_BOOTSTRAP_EMAIL    # e.g. you@yourdomain.com
wrangler secret put ADMIN_BOOTSTRAP_PASSWORD # initial admin password (change after first login)
```

Then set the matching `vars` in `wrangler.jsonc`:

- `APP_URL` — your public URL.
- `R2_ACCOUNT_ID` — your Cloudflare account ID.
- `R2_BUCKET_NAME` — the R2 bucket name.
- `MAIL_FROM` / `MAIL_REPLY_TO` — verified Resend sender.

Optional `.dev.vars` for local development:

```env
SESSION_SECRET=...
WEBHOOK_SECRET=...
APIRONE_WALLET=...
RESEND_API_KEY=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=correcthorsebatterystaple
```

### 5. Run locally

```bash
npm run dev
```

The Vite dev server is wired to the Worker via `@cloudflare/vite-plugin`, so D1 / KV / R2
all work locally.

### 6. Deploy

```bash
npm run deploy
```

### 7. Configure your Apirone wallet

1. Sign up at https://apirone.com and create a wallet for the cryptocurrency you want to accept (start with `btc`).
2. Note its wallet ID and transfer-key, set them as secrets above.
3. Optionally configure forwarding/destinations in your Apirone dashboard so customer payments are auto-swept to your cold wallet.

VisaShop generates a fresh address per order and binds the Apirone callback to that order with a signed token, so callbacks cannot be forged or replayed across orders.

## Architecture

```
worker/
  index.ts              # entry: API + webhook + SEO + SPA shell
  env.ts                # typed Env
  db/
    schema.ts           # drizzle-orm schema (used for types + migrations)
    client.ts           # drizzle d1 client factory
  lib/
    auth.ts             # session cookies, request → user
    crypto.ts           # PBKDF2, HMAC, signed tokens, slug
    http.ts             # tiny router, security headers, JSON helpers
    rate-limit.ts       # KV-backed limiter
    mail.ts             # Resend wrapper + templated emails
    apirone.ts          # Apirone Wallet v2 + Forwarding v1 + ticker
    r2.ts               # R2 presigned URL helpers
    fulfillment.ts      # atomic order fulfilment, coupons
    seo.ts              # SEO meta + sitemap + HTMLRewriter inject
  routes/
    auth.ts             # register/login/logout/password-reset
    catalog.ts          # categories + products + reviews
    checkout.ts         # quote + place order + status + downloads
    webhooks.ts         # Apirone callback handler
    account.ts          # logged-in user routes
    admin.ts            # admin panel API
    seo.ts              # sitemap/robots + per-route meta resolver

drizzle/
  migrations/           # SQL migrations (CI-ready)
  seed.sql              # demo catalogue

src/
  components/           # Layout, ProductCard, ...
  contexts/             # auth, toast
  pages/                # storefront pages
  pages/admin/          # admin pages
  lib/                  # api client, types, format, cart store
```

## Order fulfilment lifecycle

1. **Checkout** — `/api/checkout` validates cart, applies coupon, fetches the BTC→USD ticker (KV-cached), computes the exact crypto amount in minor units (BigInt-safe), generates a unique Apirone address, persists the order in `awaiting_payment`, and emails payment instructions.
2. **Customer pays** — Apirone monitors the address.
3. **Webhook** — Apirone POSTs `/api/webhooks/apirone?token=<HMAC>` with the latest confirmations.
   - Idempotent updates of `confirmations`, `tx_hash`, `crypto_received`.
   - When `received >= expected && confirmations >= APIRONE_REQUIRED_CONFIRMATIONS`, the order is moved to `paid` and `fulfilOrder()` runs.
4. **fulfilOrder()** — atomic D1 status flip, then per-item assignment:
   - `key` / `subscription` → pop one available `license_keys` row.
   - `file` / `script` → mint a 1-hour presigned R2 URL.
5. **Email** — delivery email goes out via Resend.
6. **Order page polls** every 6s and shows the keys / download buttons.

## SEO checklist

- [x] Per-route `<title>`, `<meta description>`, `<link rel="canonical">`
- [x] Open Graph + Twitter card tags
- [x] JSON-LD: `WebSite`, `Product`, `Offer`, `ItemList`, `CollectionPage`
- [x] Friendly slugs and clean URLs (`/p/:slug`, `/c/:slug`)
- [x] `/robots.txt` + `/sitemap.xml` (live from D1)
- [x] CSP + HSTS + secure cookies

## Useful commands

| Command                          | What it does                                  |
| -------------------------------- | --------------------------------------------- |
| `npm run dev`                    | Vite + Worker (D1/KV/R2) on local             |
| `npm run build`                  | Type-check + Vite build                       |
| `npm run deploy`                 | Generate types, build, deploy with Wrangler   |
| `npm run db:generate`            | Drizzle: produce a new migration              |
| `npm run db:migrate:local`       | Apply migrations to local D1                  |
| `npm run db:migrate:remote`      | Apply migrations to production D1             |
| `npm run db:seed:local`          | Seed sample products                          |

## License

UNLICENSED — for the original commissioner.
