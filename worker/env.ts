/**
 *  Application-wide environment surface, layered on top of the
 *  Cloudflare-generated `Env` interface (worker-configuration.d.ts).
 *
 *  Vars are typed as required so missing config fails fast at boot.
 *  Secrets must be configured through `wrangler secret put <NAME>`.
 */
export interface AppEnv extends Env {
  /* Bindings */
  DB: D1Database;
  KV: KVNamespace;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;

  /* Vars (wrangler.jsonc -> vars) */
  APP_NAME: string;
  APP_DESCRIPTION: string;
  APP_URL: string;
  APP_CURRENCY: string;
  APIRONE_BASE_URL: string;
  APIRONE_TICKER_DEFAULT: string;
  APIRONE_REQUIRED_CONFIRMATIONS: string;
  R2_PUBLIC_BASE: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  MAIL_FROM: string;
  MAIL_REPLY_TO: string;

  /* Secrets (wrangler secret put …) */
  SESSION_SECRET?: string;
  WEBHOOK_SECRET?: string;
  APIRONE_WALLET?: string;
  APIRONE_TRANSFER_KEY?: string;
  RESEND_API_KEY?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  ADMIN_BOOTSTRAP_EMAIL?: string;
  ADMIN_BOOTSTRAP_PASSWORD?: string;
}

export interface RequestContext {
  env: AppEnv;
  ctx: ExecutionContext;
  request: Request;
  url: URL;
  user: { id: string; email: string; name: string | null; role: 'user' | 'admin' } | null;
  ip: string;
}
