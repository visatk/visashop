import { and, desc, eq } from 'drizzle-orm';
import { Router, textResponse } from '../lib/http';
import { getDb, schema } from '../db/client';
import { buildRobots, buildSitemap } from '../lib/seo';

export const seoRoutes = new Router()
  .get('/robots.txt', (ctx) => textResponse(buildRobots(ctx.env)))
  .get('/sitemap.xml', async (ctx) => {
    const db = getDb(ctx.env);
    const products = await db
      .select({
        slug: schema.products.slug,
        updatedAt: schema.products.updatedAt,
      })
      .from(schema.products)
      .where(eq(schema.products.isActive, true))
      .all();
    const categories = await db.select({ slug: schema.categories.slug }).from(schema.categories).all();

    const urls = [
      { loc: '/', changefreq: 'daily', priority: 1.0 },
      { loc: '/shop', changefreq: 'daily', priority: 0.9 },
      { loc: '/categories', changefreq: 'weekly', priority: 0.7 },
      { loc: '/login', priority: 0.3 },
      { loc: '/register', priority: 0.3 },
      ...categories.map((c) => ({ loc: `/c/${c.slug}`, changefreq: 'weekly', priority: 0.7 })),
      ...products.map((p) => ({
        loc: `/p/${p.slug}`,
        lastmod: new Date(p.updatedAt).toISOString(),
        changefreq: 'weekly',
        priority: 0.8,
      })),
    ];
    const xml = buildSitemap(ctx.env, urls);
    return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  });

/**
 *  Resolve route-aware SEO metadata for the SPA shell.
 *  Returns null for routes that should use the default homepage meta.
 */
export async function resolveSeoForPath(env: import('../env').AppEnv, url: URL): Promise<import('../lib/seo').SeoMeta | null> {
  const base = env.APP_URL.replace(/\/$/, '');
  const canonical = base + url.pathname.replace(/\/+$/, '');
  // Normalise the path (strip trailing slash except for root).
  let path = url.pathname;
  if (path.length > 1) path = path.replace(/\/+$/, '');

  // Product detail
  if (path.startsWith('/p/')) {
    const slug = path.slice(3).replace(/\/$/, '');
    if (!slug) return null;
    const db = getDb(env);
    const rows = await db
      .select({ p: schema.products, c: schema.categories })
      .from(schema.products)
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(and(eq(schema.products.slug, slug), eq(schema.products.isActive, true)))
      .limit(1)
      .all();
    const r = rows[0];
    if (!r) return null;
    const p = r.p;
    const title = p.metaTitle ?? `${p.name} — ${env.APP_NAME}`;
    const description = p.metaDescription ?? p.shortDescription ?? `${p.name} — buy with crypto and get instant delivery.`;
    const image = p.image ? (p.image.startsWith('http') ? p.image : base + p.image) : `${base}/og-default.png`;
    return {
      title,
      description,
      keywords: p.keywords ?? undefined,
      canonical,
      type: 'product',
      image,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name,
        description: p.shortDescription ?? '',
        sku: p.id,
        category: r.c?.name,
        image,
        offers: {
          '@type': 'Offer',
          priceCurrency: env.APP_CURRENCY,
          price: (p.priceCents / 100).toFixed(2),
          availability: p.isActive ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: canonical,
        },
        aggregateRating:
          p.rating > 0
            ? { '@type': 'AggregateRating', ratingValue: (p.rating / 10).toFixed(1), reviewCount: 1 }
            : undefined,
      },
    };
  }

  // Category
  if (path.startsWith('/c/')) {
    const slug = path.slice(3).replace(/\/$/, '');
    const db = getDb(env);
    const rows = await db.select().from(schema.categories).where(eq(schema.categories.slug, slug)).limit(1).all();
    const c = rows[0];
    if (!c) return null;
    return {
      title: `${c.name} — ${env.APP_NAME}`,
      description: c.description ?? `Browse ${c.name} at ${env.APP_NAME}`,
      canonical,
      type: 'website',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: c.name,
        url: canonical,
      },
    };
  }

  if (path === '/' || path === '/shop') {
    const canonHere = path === '/' ? base + '/' : base + '/shop';
    const db = getDb(env);
    const featured = await db
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.isActive, true), eq(schema.products.isFeatured, true)))
      .orderBy(desc(schema.products.salesCount))
      .limit(8)
      .all();
    const itemListJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: featured.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${base}/p/${p.slug}`,
        name: p.name,
      })),
    };
    return {
      title: `${env.APP_NAME} — Premium digital products with instant crypto checkout`,
      description: env.APP_DESCRIPTION,
      canonical: canonHere,
      type: 'website',
      image: `${base}/og-default.png`,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: env.APP_NAME,
          url: base,
          potentialAction: {
            '@type': 'SearchAction',
            target: `${base}/shop?q={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
        },
        itemListJsonLd,
      ],
    };
  }

  return null;
}
