import { and, asc, desc, eq, like, sql, inArray } from 'drizzle-orm';
import { Router, badRequest, notFound, ok } from '../lib/http';
import { getDb, schema } from '../db/client';

const PRODUCT_CACHE_TTL = 60; // seconds

async function getCatalogVersion(env: import('../env').AppEnv): Promise<string> {
  const v = await env.KV.get('catalog:version');
  return v ?? '0';
}

interface ProductCard {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  type: string;
  priceCents: number;
  compareAtCents: number | null;
  image: string | null;
  badge: string | null;
  rating: number;
  category: { id: string; slug: string; name: string } | null;
  inStock: boolean;
}

async function getStockMap(db: ReturnType<typeof getDb>, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  // Group-by on a filtered set is far cheaper than scanning the whole
  // license_keys table once the inventory grows.
  const rows = await db
    .select({
      productId: schema.licenseKeys.productId,
      n: sql<number>`count(*)`,
    })
    .from(schema.licenseKeys)
    .where(
      and(
        eq(schema.licenseKeys.status, 'available'),
        inArray(schema.licenseKeys.productId, productIds),
      ),
    )
    .groupBy(schema.licenseKeys.productId)
    .all();
  return new Map(rows.map((r) => [r.productId, Number(r.n)]));
}

function rowToCard(p: typeof schema.products.$inferSelect, cat: typeof schema.categories.$inferSelect | null, inStock: boolean): ProductCard {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    shortDescription: p.shortDescription,
    type: p.type,
    priceCents: p.priceCents,
    compareAtCents: p.compareAtCents,
    image: p.image,
    badge: p.badge,
    rating: p.rating,
    category: cat ? { id: cat.id, slug: cat.slug, name: cat.name } : null,
    inStock,
  };
}

export const catalogRoutes = new Router()
  /* ------------------------------ Categories ----------------------------- */
  .get('/api/categories', async (ctx) => {
    const db = getDb(ctx.env);
    const rows = await db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name)).all();
    return ok(rows);
  })
  /* ------------------------------ Products ------------------------------- */
  .get('/api/products', async (ctx) => {
    const url = ctx.url;
    const q = url.searchParams.get('q')?.trim() ?? '';
    const category = url.searchParams.get('category')?.trim() ?? '';
    const type = url.searchParams.get('type')?.trim() ?? '';
    const sort = url.searchParams.get('sort') ?? 'recommended';
    const featuredOnly = url.searchParams.get('featured') === '1';
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '24', 10) || 24, 60);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

    const cacheKey = `cat:v${await getCatalogVersion(ctx.env)}:list:${q}:${category}:${type}:${sort}:${featuredOnly ? 1 : 0}:${limit}:${offset}`;
    if (!q) {
      const cached = await ctx.env.KV.get(cacheKey, 'json');
      if (cached) return ok(cached);
    }

    const db = getDb(ctx.env);
    const conds = [eq(schema.products.isActive, true)];
    if (q) conds.push(like(schema.products.name, `%${q}%`));
    if (type) conds.push(eq(schema.products.type, type as any));
    if (featuredOnly) conds.push(eq(schema.products.isFeatured, true));

    let categoryId: string | null = null;
    if (category) {
      const c = await db.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.slug, category)).all();
      if (c[0]) {
        categoryId = c[0].id;
        conds.push(eq(schema.products.categoryId, categoryId));
      }
    }

    let orderBy = [desc(schema.products.salesCount), desc(schema.products.isFeatured), desc(schema.products.createdAt)];
    if (sort === 'price_asc') orderBy = [asc(schema.products.priceCents)];
    else if (sort === 'price_desc') orderBy = [desc(schema.products.priceCents)];
    else if (sort === 'newest') orderBy = [desc(schema.products.createdAt)];
    else if (sort === 'rating') orderBy = [desc(schema.products.rating)];

    const items = await db
      .select({ p: schema.products, c: schema.categories })
      .from(schema.products)
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(...conds))
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset)
      .all();

    const totalRow = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.products)
      .where(and(...conds))
      .all();

    const stockMap = await getStockMap(db, items.map((i) => i.p.id));
    const cards = items.map(({ p, c }) => {
      const inStock =
        p.type === 'file'
          ? p.manualStock === null || p.manualStock === 0 || (p.manualStock ?? 0) > 0
          : (stockMap.get(p.id) ?? 0) > 0;
      return rowToCard(p, c, inStock);
    });

    const result = { items: cards, total: Number(totalRow[0]?.n ?? 0), limit, offset };
    if (!q) ctx.ctx.waitUntil(ctx.env.KV.put(cacheKey, JSON.stringify(result), { expirationTtl: PRODUCT_CACHE_TTL }));
    return ok(result);
  })
  /* ------------------------- Product detail ------------------------------ */
  .get('/api/products/:slug', async (ctx, params) => {
    const slug = params.slug;
    if (!slug) return badRequest('Missing slug');
    const cacheKey = `cat:v${await getCatalogVersion(ctx.env)}:detail:${slug}`;
    const cached = await ctx.env.KV.get(cacheKey, 'json');
    if (cached) return ok(cached);

    const db = getDb(ctx.env);
    const rows = await db
      .select({ p: schema.products, c: schema.categories })
      .from(schema.products)
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(eq(schema.products.slug, slug), eq(schema.products.isActive, true)))
      .limit(1)
      .all();
    if (!rows[0]) return notFound('Product not found');
    const { p, c } = rows[0];

    const stockRow = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.licenseKeys)
      .where(and(eq(schema.licenseKeys.productId, p.id), eq(schema.licenseKeys.status, 'available')))
      .all();

    const filesRows = await db
      .select({ id: schema.productFiles.id, label: schema.productFiles.label, sizeBytes: schema.productFiles.sizeBytes })
      .from(schema.productFiles)
      .where(eq(schema.productFiles.productId, p.id))
      .all();

    const reviewsRows = await db
      .select()
      .from(schema.reviews)
      .where(and(eq(schema.reviews.productId, p.id), eq(schema.reviews.isApproved, true)))
      .orderBy(desc(schema.reviews.createdAt))
      .limit(20)
      .all();

    const stock = Number(stockRow[0]?.n ?? 0);
    const inStock =
      p.type === 'file' ? (p.manualStock === null || (p.manualStock ?? 0) >= 0) : stock > 0;
    const result = {
      ...rowToCard(p, c, inStock),
      description: p.description,
      keywords: p.keywords,
      metaTitle: p.metaTitle,
      metaDescription: p.metaDescription,
      gallery: safeJsonArray(p.gallery),
      durationDays: p.durationDays,
      stock,
      files: filesRows,
      reviews: reviewsRows,
    };
    ctx.ctx.waitUntil(ctx.env.KV.put(cacheKey, JSON.stringify(result), { expirationTtl: PRODUCT_CACHE_TTL }));
    return ok(result);
  })
  /* ------------------------- Submit a review ----------------------------- */
  .post('/api/products/:slug/reviews', async (ctx, params) => {
    const body = await ctx.request.json<{ rating: number; title?: string; body?: string; authorName?: string }>().catch(() => null);
    if (!body || typeof body.rating !== 'number') return badRequest('Rating required');
    const rating = Math.max(1, Math.min(5, Math.round(body.rating)));
    const db = getDb(ctx.env);
    const rows = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.slug, params.slug)).all();
    if (!rows[0]) return notFound('Product not found');
    const id = `rv_${Math.random().toString(36).slice(2, 14)}`;
    await db.insert(schema.reviews).values({
      id,
      productId: rows[0].id,
      userId: ctx.user?.id ?? null,
      authorName: ctx.user?.name ?? body.authorName?.slice(0, 60) ?? 'Anonymous',
      rating,
      title: body.title?.slice(0, 120) ?? null,
      body: body.body?.slice(0, 4000) ?? null,
      isApproved: false,
    });
    return ok({ submitted: true });
  });

function safeJsonArray(s: string | null): unknown[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
