/**
 * Application-wide environment surface, layered on top of the
 * Cloudflare-generated `Env` interface (worker-configuration.d.ts).
 *
 * Vars are typed as required so missing config fails fast at boot.
 * Secrets must be configured through `wrangler secret put <NAME>`.
 */
export interface AppEnv extends Env {
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

  /* OAuth secrets — set per-provider so missing config disables the
     button on the login page rather than 500-ing on click. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export interface OrderWorkflowParams {
  orderId: string;
}

export interface PaymentConfirmedEvent {
  txHash: string | null;
  confirmations: number;
  receivedMinor: string;
}

export interface RequestContext {
  env: AppEnv;
  ctx: ExecutionContext;
  request: Request;
  url: URL;
  user: { id: string; email: string; name: string | null; role: 'user' | 'admin' } | null;
  ip: string;
}
