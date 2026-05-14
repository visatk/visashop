# VisaShop

A production-ready, sell-ready online digital products shop built on Cloudflare Workers
with an integrated React storefront and admin panel.

## Highlights

- **Stack**
  - **Worker**: Cloudflare Workers — single entry, smart placement, handles API, webhooks, SEO injection, sitemap/robots, the SPA shell, and a daily cron.
  - **Workflows**: Cloudflare Workflows for every long-running task (`OrderLifecycleWorkflow`, `D1BackupWorkflow`).
  - **DB**: Cloudflare D1 + drizzle-orm — snake_case columns, BigInt-safe crypto amounts (stored as TEXT to support 18-decimal ETH/BNB tokens), migrations under `drizzle/migrations`.
  - **Cache**: Cloudflare KV — product list cache (versioned for instant invalidation), exchange-rate cache, rate-limit buckets.
  - **Storage**: Cloudflare R2 — downloadable product files. Presigned URLs minted via [`aws4fetch`](https://www.npmjs.com/package/aws4fetch), Cloudflare's recommended Workers-native SigV4 client (~6 KB minified vs 1+ MB for the AWS SDK v3).
  - **Mail**: Resend (REST, no SDK).
  - **Crypto payments**: Apirone Wallet v2 + signed webhook callbacks.
- **Storefront** (React 19 + react-router 7 + Tailwind v4) — hero, featured & latest products, categories, search/filter/sort, product detail with reviews, cart, checkout with crypto picker (live USD → crypto quote), order page with QR + status polling, account with order history, password reset flow.
- **Admin panel** — dashboard with revenue tiles + low-stock alerts, products CRUD with inventory editor, license-key pool ingestion, R2 file uploads (presigned PUT scoped to product folder), categories, coupons (with expiry), reviews moderation, users + role management with self-demotion guard, orders list/detail with workflow status surface, Workflows operations panel.
- **Auto-purchase / fulfilment** — every order spawns a Workflow with the order ID as the instance ID. The workflow handles payment instructions email, the wait-for-payment timeout, atomic license-key claims (or presigned R2 URL minting), the delivery email, sales counter bumps, and catalog cache invalidation. Each side-effect lives in its own `step.do` for scoped retries and idempotency. Supports BTC, LTC, DOGE, TRX, USDT/USDC on Tron, ETH, USDT/USDC on Ethereum, and BNB chain.
- **SEO** — server-rewritten `<head>` per route via `HTMLRewriter` (canonical, OG, Twitter, JSON-LD `Product` / `Offer` / `ItemList` / `CollectionPage`), dynamic `/sitemap.xml` and `/robots.txt`.
- **Operations** — daily D1 → R2 NDJSON backup workflow (scoped per-table for granular retries), retried transactional email, KV-backed rate limiting on auth + checkout + reviews, periodic `expire stale orders` is owned by the order workflow's `waitForEvent` timeout (no polling).

## Security posture

- PBKDF2-SHA256 (210k iterations) password hashing with constant-time comparison.
- HMAC-SHA-256 signed sessions, server-side stored in D1 with TTL, scoped to the requesting device's `user-agent` + IP for forensics.
- HMAC-signed payment callback tokens — one per order, non-replayable across orders, with their own expiry.
- HMAC-signed shareable order tokens for guest checkout status polling.
- Strict CSP (`default-src 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`), HSTS preload, X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy.
- KV-backed rate limiting on `/api/auth/login`, `/api/auth/register`, password reset, checkout, and review submission.
- User-enumeration mitigation on login (constant-time response regardless of whether the email exists).
- File-upload presigning is scoped per product folder; the file metadata insert verifies the supplied `r2Key` lives under the product's directory before persisting.
- Self-demotion of the last admin is rejected.
- Cookies are `Secure` over HTTPS and switch to non-Secure for local HTTP dev so login works in both environments.

## Workflows

VisaShop uses two Workflows, both bound in `wrangler.jsonc` and re-exported from `worker/index.ts`:

| Workflow                  | Class                     | Trigger                                                          |
| ------------------------- | ------------------------- | ---------------------------------------------------------------- |
| `visashop-order-lifecycle` | `OrderLifecycleWorkflow` | `env.ORDER_WORKFLOW.create({ id: orderId })` from `/api/checkout` |
| `visashop-d1-backup`       | `D1BackupWorkflow`       | Cron (`0 4 * * *`) + manual `POST /api/admin/backups`             |

The order workflow steps are:

1. `load-order` — pulls the canonical order snapshot from D1.
2. `send-payment-instructions` — Resend email with payment QR + URL (8 retries, exponential backoff).
3. `wait-for-payment` — `step.waitForEvent('payment-confirmed', { timeout: env.ORDER_PAYMENT_TIMEOUT })`. The Apirone webhook calls `instance.sendEvent({ type: 'payment-confirmed', payload })` to advance the wait.
4. `mark-expired` (only on timeout) — flips the order status to `expired` and exits.
5. `mark-paid` — atomic D1 transition. BigInt-safe `crypto_received` max comparison done in JS to avoid the SQLite int64 overflow that 18-decimal ERC-20 amounts hit.
6. `deliver-item-<id>` (one step per order item) — claims a license key with an atomic `UPDATE … WHERE status='available'` race-free claim, or mints a presigned R2 URL. Re-runs are safe because each step re-checks `deliveredKey` first.
7. `mark-fulfilled` / `bump-sales` / `audit-fulfilment` / `bust-catalog-cache` / `send-delivery-email` — all retried independently.

The webhook is a thin event forwarder: it verifies the signed token, persists the latest confirmation count + tx hash, and `instance.sendEvent`s the workflow. If the workflow instance has been lost (rare) the webhook attempts to recreate it from the persisted order — every step is idempotent so this is safe.

The backup workflow walks every domain table, pages results in 500-row chunks, and writes one NDJSON object to R2 per chunk plus a `manifest.json`. Each table is its own step, so a retry only re-runs the failing slice.

Inspect or restart any workflow:

- Order workflow → admin **Orders** detail → "Restart workflow" / "Fulfil now" (which routes through `instance.sendEvent` if waiting, or `instance.restart({ from: { name: 'mark-paid' } })` otherwise).
- Backup workflow → admin **Workflows** → "Run backup now".

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
- `ORDER_PAYMENT_TIMEOUT` — payment window (e.g. `"1 hour"`); the order workflow expires after this.

Optional `.dev.vars` for local development:

```env
SESSION_SECRET=local-dev-secret-change-me-32-bytes
WEBHOOK_SECRET=local-dev-webhook-secret-change-me
APIRONE_WALLET=
RESEND_API_KEY=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=correcthorsebatterystaple
```

### 5. Run locally

```bash
npm run dev
```

Workflows run locally via the Vite Cloudflare plugin too — including `step.waitForEvent` and the daily cron (you can fire the cron manually with `wrangler cron trigger visashop`).

### 6. Deploy

```bash
npm run deploy
```

### 7. Configure your Apirone wallet

1. Sign up at https://apirone.com and create a wallet for the cryptocurrency you want to accept (start with `btc`).
2. Set its wallet ID and transfer-key as secrets.
3. Optionally configure forwarding/destinations in your Apirone dashboard so customer payments are auto-swept to your cold wallet.

VisaShop generates a fresh address per order and binds the Apirone callback to that order with a signed token, so callbacks cannot be forged or replayed across orders.

## Architecture

```
worker/
  index.ts              # entry: API + webhook + SEO + SPA shell + cron
  env.ts                # typed Env (incl. ORDER_WORKFLOW + BACKUP_WORKFLOW)
  db/
    schema.ts           # drizzle-orm schema
    client.ts           # drizzle d1 client factory
  lib/
    auth.ts             # session cookies, request → user
    crypto.ts           # PBKDF2, HMAC, signed tokens, slug
    http.ts             # tiny router, security headers, JSON helpers
    rate-limit.ts       # KV-backed limiter
    mail.ts             # Resend wrapper + templated emails
    apirone.ts          # Apirone Wallet v2 + Forwarding v1 + ticker, BigInt-safe math
    r2.ts               # R2 presigned URL helpers via aws4fetch
    fulfillment.ts      # coupon helper (workflow owns the rest)
    seo.ts              # SEO meta + sitemap + HTMLRewriter inject
  routes/               # auth, catalog, checkout, account, admin, webhooks, seo
  workflows/
    order-lifecycle.ts  # OrderLifecycleWorkflow — payment + fulfilment
    d1-backup.ts        # D1BackupWorkflow — daily D1 → R2 backup

drizzle/
  migrations/           # SQL migrations (CI-ready)
  seed.sql              # demo catalogue

src/                    # React storefront + admin SPA
  components/           # Layout, ProductCard
  contexts/             # AuthContext, ToastContext (memoised value)
  lib/                  # api, cart store, formatters, types, utils
  pages/                # storefront pages
  pages/admin/          # admin pages (Dashboard, Products, Categories, Orders, Coupons, Reviews, Users, Workflows, ProductKeys)
```

## Useful commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Vite + Worker (D1/KV/R2/Workflows + cron) on local |
| `npm run build` | `tsc -b` (all project refs) then `vite build` |
| `npm run lint` | ESLint over the repo |
| `npm run preview` | Build + `vite preview` |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `npm run deploy` | `cf-typegen` + build + `wrangler deploy` |
| `npm run db:generate` | Drizzle: produce a new SQL migration |
| `npm run db:migrate:local` | Apply migrations to local D1 |
| `npm run db:migrate:remote` | Apply migrations to production D1 |
| `npm run db:seed:local` | Seed sample products into local D1 |
| `npm run db:seed:remote` | Seed sample products into production D1 |
| `wrangler workflows list visashop-order-lifecycle` | Inspect order workflow instances |
| `wrangler workflows list visashop-d1-backup` | Inspect backup runs |
| `wrangler cron trigger visashop` | Fire the daily cron locally |
| `wrangler secret put <NAME>` | Configure a secret |

## License

UNLICENSED — for the original commissioner.
