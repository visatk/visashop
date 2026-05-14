/**
 *  VisaShop — Cloudflare Worker entry point.
 *
 *  Responsibilities:
 *    1. JSON API under /api/*
 *    2. Apirone webhook callback at /api/webhooks/apirone (forwards
 *       confirmation events into the order workflow)
 *    3. /sitemap.xml + /robots.txt
 *    4. Per-route SEO meta + JSON-LD injection on the SPA shell
 *    5. Cron handler (calls the D1 backup workflow daily)
 *    6. One-shot admin bootstrap from secrets
 *
 *  Long-running tasks (order fulfilment, mail with retries, expiry,
 *  daily DB backup) are handled by Cloudflare Workflows; see
 *  `worker/workflows/*`. We re-export those classes here so wrangler
 *  finds them by `class_name`.
 */
import type { AppEnv } from './env';
import { Router, buildContext, jsonResponse, corsPreflight, SECURITY_HEADERS } from './lib/http';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { checkoutRoutes } from './routes/checkout';
import { webhookRoutes } from './routes/webhooks';
import { adminRoutes } from './routes/admin';
import { accountRoutes } from './routes/account';
import { seoRoutes, resolveSeoForPath } from './routes/seo';
import { defaultMeta, injectSeo } from './lib/seo';
import { getDb, schema } from './db/client';
import { hashPassword, randomId } from './lib/crypto';
import { eq } from 'drizzle-orm';

/* Re-export the workflow classes so the runtime wires them up. */
export { OrderLifecycleWorkflow } from './workflows/order-lifecycle';
export { D1BackupWorkflow } from './workflows/d1-backup';

let bootstrapped = false;

async function bootstrapAdminOnce(env: AppEnv) {
  if (bootstrapped) return;
  bootstrapped = true;
  if (!env.ADMIN_BOOTSTRAP_EMAIL || !env.ADMIN_BOOTSTRAP_PASSWORD) return;
  try {
    const db = getDb(env);
    const email = env.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase();
    const existing = await db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)
      .all();
    if (existing[0]) {
      if (existing[0].role !== 'admin') {
        await db
          .update(schema.users)
          .set({ role: 'admin' })
          .where(eq(schema.users.id, existing[0].id));
        console.log('[bootstrap] promoted existing user to admin');
      }
      return;
    }
    try {
      await db.insert(schema.users).values({
        id: `usr_${randomId(12)}`,
        email,
        passwordHash: await hashPassword(env.ADMIN_BOOTSTRAP_PASSWORD),
        name: 'Administrator',
        role: 'admin',
        emailVerified: true,
      });
      console.log('[bootstrap] admin user created:', email);
    } catch (err) {
      // UNIQUE conflict from a parallel cold-start is fine.
      console.warn('[bootstrap] insert skipped', err);
    }
  } catch (err) {
    console.error('[bootstrap] failed', err);
  }
}

const apiRouter = new Router();
for (const r of [authRoutes, catalogRoutes, checkoutRoutes, accountRoutes, adminRoutes, webhookRoutes, seoRoutes]) {
  apiRouter.merge(r);
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    /* One-shot admin bootstrap (no-op after the first request). */
    ctx.waitUntil(bootstrapAdminOnce(env));

    const preflight = corsPreflight(request);
    if (preflight) return preflight;

    const ctxObj = await buildContext(request, env, ctx);

    /* 1. API + webhooks + SEO endpoints */
    const apiRes = await apiRouter.handle(ctxObj);
    if (apiRes) return apiRes;

    /* 2. Health check */
    if (ctxObj.url.pathname === '/api/health') {
      return jsonResponse({ ok: true, name: env.APP_NAME, time: Date.now() });
    }

    /* 3. Anything else under /api/* — 404 */
    if (ctxObj.url.pathname.startsWith('/api/')) {
      return jsonResponse({ ok: false, error: 'API route not found' }, { status: 404 });
    }

    /* 4. Static assets / SPA shell with SEO rewrite */
    const assetRes = await env.ASSETS.fetch(request);
    const ct = assetRes.headers.get('Content-Type') ?? '';
    if (ct.includes('text/html') && assetRes.body) {
      const meta = (await resolveSeoForPath(env, ctxObj.url)) ?? defaultMeta(env, ctxObj.url);
      const rewritten = injectSeo(assetRes, meta, env);
      const headers = new Headers(rewritten.headers);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
      headers.set(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "img-src 'self' data: blob: https://api.qrserver.com",
          "style-src 'self' 'unsafe-inline'",
          "script-src 'self'",
          "connect-src 'self' https://apirone.com https://api.resend.com",
          "font-src 'self' data:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          'upgrade-insecure-requests',
        ].join('; '),
      );
      return new Response(rewritten.body, { status: rewritten.status, headers });
    }
    return assetRes;
  },

  /**
   *  Cron handler — triggers a fresh D1 backup workflow once per
   *  schedule tick. The workflow itself owns retries + per-table
   *  step idempotency.
   */
  async scheduled(controller: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          const id = `backup-${new Date(controller.scheduledTime).toISOString().slice(0, 10)}-${randomId(4)}`;
          const instance = await env.BACKUP_WORKFLOW.create({ id, params: {} });
          console.log('[cron] backup workflow created', instance.id);
        } catch (err) {
          console.error('[cron] failed to create backup workflow', err);
        }
      })(),
    );
  },
} satisfies ExportedHandler<AppEnv>;
