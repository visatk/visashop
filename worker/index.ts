/**
 *  VisaShop — Cloudflare Worker entry point.
 *
 *  Responsibilities:
 *    1. Provide the JSON API under /api/*
 *    2. Serve Apirone webhook callbacks at /api/webhooks/apirone
 *    3. Emit /sitemap.xml and /robots.txt
 *    4. For HTML SPA navigations, intercept the ASSETS response
 *       and inject route-aware SEO meta + JSON-LD.
 *    5. Bootstrap the first admin user from secrets if missing,
 *       and run a tiny housekeeping pass to expire stale orders.
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
import { expireStaleOrders } from './lib/fulfillment';

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
        await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, existing[0].id));
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
      // Could be a UNIQUE conflict from a parallel cold-start — that's fine.
      console.warn('[bootstrap] insert skipped', err);
    }
  } catch (err) {
    console.error('[bootstrap] failed', err);
  }
}

async function maybeRunHousekeeping(env: AppEnv): Promise<void> {
  try {
    const last = await env.KV.get('housekeeping:last');
    const now = Math.floor(Date.now() / 1000);
    if (last && now - Number(last) < 60) return;
    await env.KV.put('housekeeping:last', String(now), { expirationTtl: 600 });
    const expired = await expireStaleOrders(env);
    if (expired > 0) console.log('[housekeeping] expired', expired, 'orders');
  } catch (err) {
    console.warn('[housekeeping] failed', err);
  }
}

const apiRouter = new Router();
for (const r of [authRoutes, catalogRoutes, checkoutRoutes, accountRoutes, adminRoutes, webhookRoutes, seoRoutes]) {
  apiRouter.merge(r);
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    // One-shot admin bootstrap (no-op after the first request).
    ctx.waitUntil(bootstrapAdminOnce(env));

    const preflight = corsPreflight(request);
    if (preflight) return preflight;

    const ctxObj = await buildContext(request, env, ctx);

    // Run periodic housekeeping in the background — cheap and idempotent.
    // Throttled via KV so it runs at most once per minute regardless of QPS.
    ctx.waitUntil(maybeRunHousekeeping(env));

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
    if (ct.includes('text/html')) {
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
          "upgrade-insecure-requests",
        ].join('; '),
      );
      return new Response(rewritten.body, { status: rewritten.status, headers });
    }
    return assetRes;
  },
} satisfies ExportedHandler<AppEnv>;
