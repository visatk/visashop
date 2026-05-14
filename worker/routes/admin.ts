/**
 *  Admin API. All endpoints require role === 'admin'.
 *  We never expose any of these on the SPA without a role check;
 *  the frontend also gates the routes, but the worker is the
 *  authoritative perimeter.
 */
import { and, desc, eq, sql, gte } from 'drizzle-orm';
import {
  Router,
  badRequest,
  forbidden,
  notFound,
  ok,
  readJson,
  unauthorized,
} from '../lib/http';
import { randomId, slugify, hashPassword } from '../lib/crypto';
import { getDb, schema } from '../db/client';
import type { RequestContext } from '../env';
import { presignUploadUrl, deleteObject } from '../lib/r2';

function requireAdmin(ctx: RequestContext): Response | null {
  if (!ctx.user) return unauthorized();
  if (ctx.user.role !== 'admin') return forbidden('Admin only');
  return null;
}

export const adminRoutes = new Router()
  /* ------------------------------ Stats ----------------------------------*/
  .get('/api/admin/stats', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const sinceTs = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30;

    const [productCount] = await db.select({ n: sql<number>`count(*)` }).from(schema.products).all();
    const [userCount] = await db.select({ n: sql<number>`count(*)` }).from(schema.users).all();
    const [orderCount] = await db.select({ n: sql<number>`count(*)` }).from(schema.orders).all();
    const [revenueRow] = await db
      .select({
        cents: sql<number>`coalesce(sum(${schema.orders.totalCents}), 0)`,
      })
      .from(schema.orders)
      .where(eq(schema.orders.status, 'fulfilled'))
      .all();
    const [recentRevenueRow] = await db
      .select({
        cents: sql<number>`coalesce(sum(${schema.orders.totalCents}), 0)`,
      })
      .from(schema.orders)
      .where(and(eq(schema.orders.status, 'fulfilled'), gte(schema.orders.createdAt, new Date(sinceTs * 1000))))
      .all();

    const recentOrders = await db.select().from(schema.orders).orderBy(desc(schema.orders.createdAt)).limit(10).all();
    const lowStockResult = await ctx.env.DB.prepare(
      `SELECT p.id, p.name, p.slug, p.type,
              COALESCE(COUNT(CASE WHEN lk.status='available' THEN 1 END), 0) AS available
       FROM products p
       LEFT JOIN license_keys lk ON lk.product_id = p.id
       WHERE p.is_active = 1 AND p.type IN ('key','subscription')
       GROUP BY p.id
       HAVING available <= 3
       ORDER BY available ASC
       LIMIT 10`,
    ).all<{ id: string; name: string; slug: string; type: string; available: number }>();

    return ok({
      productCount: Number(productCount.n),
      userCount: Number(userCount.n),
      orderCount: Number(orderCount.n),
      revenueCents: Number(revenueRow.cents ?? 0),
      revenueLast30Cents: Number(recentRevenueRow.cents ?? 0),
      recentOrders,
      lowStock: lowStockResult.results ?? [],
    });
  })

  /* ----------------------------- Products --------------------------------*/
  .get('/api/admin/products', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const rows = await db
      .select({ p: schema.products, c: schema.categories })
      .from(schema.products)
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .orderBy(desc(schema.products.createdAt))
      .all();
    return ok(rows.map((r) => ({ ...r.p, category: r.c })));
  })
  .post('/api/admin/products', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const body = await readJson<
      Partial<typeof schema.products.$inferInsert> & {
        name: string;
        priceCents: number;
        gallery?: string | unknown[];
      }
    >(ctx.request);
    if (!body?.name || typeof body.priceCents !== 'number' || body.priceCents < 0) {
      return badRequest('name and non-negative priceCents required');
    }
    const db = getDb(ctx.env);
    const id = `prd_${randomId(10)}`;
    const slug = body.slug?.trim() ? slugify(body.slug) : slugify(body.name) + '-' + randomId(2);
    /* Conflict check on slug to avoid the unique-index error spilling out raw. */
    const existingSlug = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.slug, slug))
      .all();
    if (existingSlug[0]) return badRequest('Slug already in use — pick a different name or slug.');
    /* Make sure gallery is JSON-serialisable. */
    let gallery: string | null = null;
    if (typeof body.gallery === 'string') gallery = body.gallery;
    else if (Array.isArray(body.gallery)) gallery = JSON.stringify(body.gallery);
    await db.insert(schema.products).values({
      id,
      slug,
      name: body.name,
      shortDescription: body.shortDescription ?? null,
      description: body.description ?? null,
      type: (body.type as 'key' | 'file' | 'subscription' | 'script') ?? 'key',
      categoryId: body.categoryId ?? null,
      priceCents: body.priceCents,
      compareAtCents: body.compareAtCents ?? null,
      image: body.image ?? null,
      gallery,
      badge: body.badge ?? null,
      rating: body.rating ?? 0,
      metaTitle: body.metaTitle ?? null,
      metaDescription: body.metaDescription ?? null,
      keywords: body.keywords ?? null,
      durationDays: body.durationDays ?? null,
      manualStock: body.manualStock ?? null,
      isActive: body.isActive ?? true,
      isFeatured: body.isFeatured ?? false,
    });
    await invalidateCatalog(ctx.env);
    return ok({ id, slug });
  })
  .patch('/api/admin/products/:id', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const body = await readJson<Partial<typeof schema.products.$inferInsert> & { gallery?: string | unknown[] }>(ctx.request);
    if (!body) return badRequest('Body required');
    const db = getDb(ctx.env);
    const { id: _ignoredId, gallery: rawGallery, ...rest } = body;
    void _ignoredId;
    const updates: Partial<typeof schema.products.$inferInsert> = { ...rest, updatedAt: new Date() };
    if (rest.slug) updates.slug = slugify(rest.slug);
    if (Array.isArray(rawGallery)) updates.gallery = JSON.stringify(rawGallery);
    else if (typeof rawGallery === 'string') updates.gallery = rawGallery;
    await db.update(schema.products).set(updates).where(eq(schema.products.id, params.id));
    await invalidateCatalog(ctx.env);
    return ok({ updated: true });
  })
  .delete('/api/admin/products/:id', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    await db.delete(schema.products).where(eq(schema.products.id, params.id));
    await invalidateCatalog(ctx.env);
    return ok({ deleted: true });
  })

  /* --------------------------- License keys ------------------------------*/
  .get('/api/admin/products/:id/keys', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const rows = await db.select().from(schema.licenseKeys).where(eq(schema.licenseKeys.productId, params.id)).orderBy(desc(schema.licenseKeys.createdAt)).limit(500).all();
    return ok(rows);
  })
  .post('/api/admin/products/:id/keys', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const body = await readJson<{ keys: string[] }>(ctx.request);
    if (!body || !Array.isArray(body.keys)) return badRequest('keys array required');
    const db = getDb(ctx.env);
    let added = 0;
    for (const raw of body.keys) {
      const v = raw.trim();
      if (!v) continue;
      try {
        await db.insert(schema.licenseKeys).values({
          id: `lk_${randomId(8)}`,
          productId: params.id,
          keyValue: v,
          status: 'available',
        });
        added++;
      } catch (err) {
        console.warn('skipping duplicate key', err);
      }
    }
    return ok({ added });
  })

  /* ------------------------------ Files ----------------------------------*/
  .get('/api/admin/products/:id/files', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const rows = await db.select().from(schema.productFiles).where(eq(schema.productFiles.productId, params.id)).all();
    return ok(rows);
  })
  .post('/api/admin/products/:id/files/presign', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const body = await readJson<{ filename: string; contentType?: string; sizeBytes?: number }>(ctx.request);
    if (!body?.filename) return badRequest('filename required');
    // Verify product exists so we don't spawn orphaned R2 objects.
    const db = getDb(ctx.env);
    const exists = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, params.id))
      .limit(1)
      .all();
    if (!exists[0]) return notFound('Product not found');
    // Cap presigned upload TTL and content-type to safe values.
    const safeName = slugify(body.filename) || 'file';
    const r2Key = `products/${params.id}/${Date.now()}-${safeName}`;
    const url = await presignUploadUrl(ctx.env, r2Key, body.contentType, 600);
    return ok({ uploadUrl: url, r2Key });
  })
  .post('/api/admin/products/:id/files', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const body = await readJson<{ label: string; r2Key: string; sizeBytes?: number; mimeType?: string }>(ctx.request);
    if (!body?.label || !body?.r2Key) return badRequest('label and r2Key required');
    // The r2Key must live under this product's folder. Prevents an
    // admin (compromised or otherwise) from registering a key that
    // points at someone else's path.
    if (!body.r2Key.startsWith(`products/${params.id}/`)) {
      return badRequest('r2Key must reference this product folder');
    }
    const db = getDb(ctx.env);
    const id = `pf_${randomId(8)}`;
    await db.insert(schema.productFiles).values({
      id,
      productId: params.id,
      label: body.label.slice(0, 120),
      r2Key: body.r2Key,
      sizeBytes: body.sizeBytes ?? null,
      mimeType: body.mimeType ?? null,
    });
    return ok({ id });
  })
  .delete('/api/admin/products/:id/files/:fileId', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const rows = await db.select().from(schema.productFiles).where(eq(schema.productFiles.id, params.fileId)).all();
    if (rows[0]) {
      try { await deleteObject(ctx.env, rows[0].r2Key); } catch (e) { console.warn('R2 delete', e); }
      await db.delete(schema.productFiles).where(eq(schema.productFiles.id, params.fileId));
    }
    return ok({ deleted: true });
  })

  /* ---------------------------- Categories -------------------------------*/
  .get('/api/admin/categories', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const rows = await db.select().from(schema.categories).orderBy(schema.categories.sortOrder).all();
    return ok(rows);
  })
  .post('/api/admin/categories', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const body = await readJson<{ name: string; description?: string; image?: string; sortOrder?: number }>(ctx.request);
    if (!body?.name) return badRequest('name required');
    const id = `cat_${randomId(6)}`;
    const db = getDb(ctx.env);
    const slug = slugify(body.name);
    await db.insert(schema.categories).values({
      id,
      slug,
      name: body.name,
      description: body.description ?? null,
      image: body.image ?? null,
      sortOrder: body.sortOrder ?? 0,
    });
    await invalidateCatalog(ctx.env);
    return ok({ id, slug });
  })
  .patch('/api/admin/categories/:id', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const body = await readJson<Partial<typeof schema.categories.$inferInsert>>(ctx.request);
    if (!body) return badRequest('Body required');
    // Strip id from the update set — patching the primary key would corrupt FKs.
    const { id: _ignoredId, ...rest } = body;
    void _ignoredId;
    const updates: Partial<typeof schema.categories.$inferInsert> = { ...rest };
    if (rest.name && !rest.slug) updates.slug = slugify(rest.name);
    if (rest.slug) updates.slug = slugify(rest.slug);
    const db = getDb(ctx.env);
    await db.update(schema.categories).set(updates).where(eq(schema.categories.id, params.id));
    await invalidateCatalog(ctx.env);
    return ok({ updated: true });
  })
  .delete('/api/admin/categories/:id', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    await db.delete(schema.categories).where(eq(schema.categories.id, params.id));
    await invalidateCatalog(ctx.env);
    return ok({ deleted: true });
  })

  /* ------------------------------ Coupons --------------------------------*/
  .get('/api/admin/coupons', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const rows = await db.select().from(schema.coupons).orderBy(desc(schema.coupons.createdAt)).all();
    return ok(rows);
  })
  .post('/api/admin/coupons', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const body = await readJson<{
      code: string;
      type?: 'percent' | 'fixed';
      value: number;
      minSubtotalCents?: number;
      maxRedemptions?: number | null;
      expiresAt?: string | number | null;
      isActive?: boolean;
    }>(ctx.request);
    if (!body?.code || typeof body.value !== 'number') return badRequest('code and value required');
    const id = `cp_${randomId(6)}`;
    const db = getDb(ctx.env);
    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (!Number.isNaN(d.getTime())) expiresAt = d;
    }
    await db.insert(schema.coupons).values({
      id,
      code: body.code.toUpperCase().slice(0, 32),
      type: body.type ?? 'percent',
      value: body.value,
      minSubtotalCents: body.minSubtotalCents ?? 0,
      maxRedemptions: body.maxRedemptions ?? null,
      expiresAt,
      isActive: body.isActive ?? true,
    });
    return ok({ id });
  })
  .delete('/api/admin/coupons/:id', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    await db.delete(schema.coupons).where(eq(schema.coupons.id, params.id));
    return ok({ deleted: true });
  })

  /* ------------------------------ Orders ---------------------------------*/
  .get('/api/admin/orders', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const status = ctx.url.searchParams.get('status') ?? '';
    const db = getDb(ctx.env);
    const VALID_STATUSES = [
      'pending', 'awaiting_payment', 'partial', 'paid', 'fulfilled', 'expired', 'cancelled', 'refunded',
    ] as const;
    type OrderStatus = typeof VALID_STATUSES[number];
    const isValid = (s: string): s is OrderStatus => (VALID_STATUSES as readonly string[]).includes(s);
    const baseSelect = db.select().from(schema.orders);
    const rows = isValid(status)
      ? await baseSelect.where(eq(schema.orders.status, status)).orderBy(desc(schema.orders.createdAt)).limit(200).all()
      : await baseSelect.orderBy(desc(schema.orders.createdAt)).limit(200).all();
    return ok(rows);
  })
  .get('/api/admin/orders/:id', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const o = await db.select().from(schema.orders).where(eq(schema.orders.id, params.id)).limit(1).all();
    if (!o[0]) return notFound('Order not found');
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, params.id)).all();
    return ok({ ...o[0], items });
  })
  .post('/api/admin/orders/:id/fulfil', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    /**
     *  Re-drive the order workflow. Two cases:
     *    1. The workflow is still alive but stuck waiting for a
     *       payment event — send a synthetic "payment-confirmed" so
     *       it advances to fulfilment.
     *    2. The workflow has terminated/expired — restart it from the
     *       `mark-paid` step so it picks up where it left off.
     */
    const db = getDb(ctx.env);
    const rows = await db
      .select({
        cryptoAmount: schema.orders.cryptoAmount,
        cryptoReceived: schema.orders.cryptoReceived,
        paymentConfirmations: schema.orders.paymentConfirmations,
        paymentTxHash: schema.orders.paymentTxHash,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, params.id))
      .limit(1)
      .all();
    if (!rows[0]) return badRequest('Order not found', 404);

    try {
      const instance = await ctx.env.ORDER_WORKFLOW.get(params.id);
      const status = await instance.status();
      if (status.status === 'waiting' || status.status === 'running' || status.status === 'paused') {
        if (status.status === 'paused') await instance.resume();
        await instance.sendEvent({
          type: 'payment-confirmed',
          payload: {
            txHash: rows[0].paymentTxHash,
            confirmations: Math.max(rows[0].paymentConfirmations, 1),
            receivedMinor: rows[0].cryptoReceived ?? rows[0].cryptoAmount ?? '0',
          },
        });
        return ok({ action: 'event-sent' });
      }
      if (status.status === 'errored' || status.status === 'terminated' || status.status === 'complete') {
        await instance.restart({ from: { name: 'mark-paid' } });
        return ok({ action: 'restarted' });
      }
      return ok({ action: 'no-op', status: status.status });
    } catch {
      // No instance — recreate one.
      const created = await ctx.env.ORDER_WORKFLOW.create({
        id: params.id,
        params: { orderId: params.id },
      });
      return ok({ action: 'created', instanceId: created.id });
    }
  })
  .post('/api/admin/orders/:id/restart-workflow', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    try {
      const instance = await ctx.env.ORDER_WORKFLOW.get(params.id);
      await instance.restart();
      return ok({ restarted: true });
    } catch (err) {
      return badRequest(`Could not restart workflow: ${(err as Error).message}`, 502);
    }
  })
  .get('/api/admin/orders/:id/workflow', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    try {
      const instance = await ctx.env.ORDER_WORKFLOW.get(params.id);
      const status = await instance.status();
      return ok({ id: instance.id, ...status });
    } catch (err) {
      return ok({ id: params.id, status: 'unknown', error: (err as Error).message });
    }
  })
  .post('/api/admin/backups', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const id = `manual-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomId(4)}`;
    try {
      const instance = await ctx.env.BACKUP_WORKFLOW.create({ id, params: {} });
      return ok({ id: instance.id, status: await instance.status() });
    } catch (err) {
      return badRequest(`Could not start backup: ${(err as Error).message}`, 502);
    }
  })
  .get('/api/admin/backups/:id', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    try {
      const instance = await ctx.env.BACKUP_WORKFLOW.get(params.id);
      return ok({ id: instance.id, ...(await instance.status()) });
    } catch (err) {
      return badRequest(`Backup not found: ${(err as Error).message}`, 404);
    }
  })
  .post('/api/admin/orders/:id/cancel', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    await db
      .update(schema.orders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(schema.orders.id, params.id));
    // Best-effort: terminate the running workflow so it doesn't keep
    // sleeping waiting for a payment that won't come.
    try {
      const instance = await ctx.env.ORDER_WORKFLOW.get(params.id);
      const status = await instance.status();
      if (status.status === 'running' || status.status === 'waiting' || status.status === 'paused') {
        await instance.terminate();
      }
    } catch {
      /* no instance — fine */
    }
    return ok({ cancelled: true });
  })
  .post('/api/admin/orders/:id/refund', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    await db
      .update(schema.orders)
      .set({ status: 'refunded', updatedAt: new Date() })
      .where(eq(schema.orders.id, params.id));
    return ok({ refunded: true });
  })

  /* ------------------------------ Reviews --------------------------------*/
  .get('/api/admin/reviews', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const rows = await db.select().from(schema.reviews).orderBy(desc(schema.reviews.createdAt)).limit(200).all();
    return ok(rows);
  })
  .post('/api/admin/reviews/:id/approve', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    await db.update(schema.reviews).set({ isApproved: true }).where(eq(schema.reviews.id, params.id));
    return ok({ approved: true });
  })
  .delete('/api/admin/reviews/:id', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    await db.delete(schema.reviews).where(eq(schema.reviews.id, params.id));
    return ok({ deleted: true });
  })

  /* ------------------------------ Users ----------------------------------*/
  .get('/api/admin/users', async (ctx) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const db = getDb(ctx.env);
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt))
      .limit(200)
      .all();
    return ok(rows);
  })
  .patch('/api/admin/users/:id', async (ctx, params) => {
    const guard = requireAdmin(ctx);
    if (guard) return guard;
    const body = await readJson<{ role?: 'user' | 'admin'; password?: string; name?: string }>(ctx.request);
    if (!body) return badRequest('Body required');
    // Don't let an admin demote themselves into a footgun.
    if (ctx.user?.id === params.id && body.role === 'user') {
      return badRequest('You cannot demote your own admin account.');
    }
    const db = getDb(ctx.env);
    const updates: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
    if (body.role) updates.role = body.role;
    if (body.name !== undefined) updates.name = body.name;
    if (body.password) {
      if (body.password.length < 8) return badRequest('Password too short');
      updates.passwordHash = await hashPassword(body.password);
    }
    await db.update(schema.users).set(updates).where(eq(schema.users.id, params.id));
    return ok({ updated: true });
  });

async function invalidateCatalog(env: import('../env').AppEnv) {
  // Catalog cache keys are namespaced by `catalog_v:<n>:…` and the
  // catalog routes consult this counter to derive their cache keys.
  // Bumping it instantly invalidates every cached entry without
  // needing prefix deletes (which KV does not support).
  const current = await env.KV.get('catalog:version');
  const next = String((Number(current) || 0) + 1);
  await env.KV.put('catalog:version', next);
}
