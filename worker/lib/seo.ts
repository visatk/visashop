/**
 *  Server-side SEO injection.
 *
 *  We let Cloudflare assets serve the raw `index.html` as the SPA shell,
 *  but for product / category / homepage routes we transparently
 *  intercept the response and rewrite the <head> with route-aware
 *  meta tags and JSON-LD. This satisfies search-engine crawlers
 *  without sacrificing the SPA experience for users.
 */
import type { AppEnv } from '../env';

export interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  image?: string;
  type?: 'website' | 'article' | 'product';
  jsonLd?: object | object[];
  keywords?: string;
  noindex?: boolean;
}

export function defaultMeta(env: AppEnv, url: URL): SeoMeta {
  return {
    title: env.APP_NAME,
    description: env.APP_DESCRIPTION,
    canonical: env.APP_URL.replace(/\/$/, '') + url.pathname,
    type: 'website',
    image: env.APP_URL.replace(/\/$/, '') + '/og-default.png',
  };
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderHeadTags(meta: SeoMeta, env: AppEnv): string {
  const parts: string[] = [];
  parts.push(`<title>${escape(meta.title)}</title>`);
  parts.push(`<meta name="description" content="${escape(meta.description)}">`);
  if (meta.keywords) parts.push(`<meta name="keywords" content="${escape(meta.keywords)}">`);
  parts.push(`<link rel="canonical" href="${escape(meta.canonical)}">`);
  if (meta.noindex) parts.push(`<meta name="robots" content="noindex,nofollow">`);
  parts.push(`<meta name="theme-color" content="#5b2dba">`);

  // Open Graph
  parts.push(`<meta property="og:title" content="${escape(meta.title)}">`);
  parts.push(`<meta property="og:description" content="${escape(meta.description)}">`);
  parts.push(`<meta property="og:type" content="${meta.type ?? 'website'}">`);
  parts.push(`<meta property="og:url" content="${escape(meta.canonical)}">`);
  parts.push(`<meta property="og:site_name" content="${escape(env.APP_NAME)}">`);
  if (meta.image) parts.push(`<meta property="og:image" content="${escape(meta.image)}">`);

  // Twitter
  parts.push(`<meta name="twitter:card" content="summary_large_image">`);
  parts.push(`<meta name="twitter:title" content="${escape(meta.title)}">`);
  parts.push(`<meta name="twitter:description" content="${escape(meta.description)}">`);
  if (meta.image) parts.push(`<meta name="twitter:image" content="${escape(meta.image)}">`);

  // Preload favicon
  parts.push(`<link rel="icon" type="image/svg+xml" href="/favicon.svg">`);

  if (meta.jsonLd) {
    const arr = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
    for (const j of arr) {
      const json = JSON.stringify(j).replace(/</g, '\\u003c');
      parts.push(`<script type="application/ld+json">${json}</script>`);
    }
  }
  return parts.join('\n    ');
}

/**
 *  Stream-safe head rewrite using HTMLRewriter — clears existing
 *  <title>/<meta>/<link rel="canonical">/<script type=ld> in <head>
 *  and prepends our SEO block at the top.
 */
export function injectSeo(response: Response, meta: SeoMeta, env: AppEnv): Response {
  if (!response.headers.get('Content-Type')?.includes('text/html')) return response;
  const headFrag = renderHeadTags(meta, env);
  const rewriter = new HTMLRewriter()
    .on('head > title', { element: (el) => el.remove() })
    .on('head > meta[name="description"]', { element: (el) => el.remove() })
    .on('head > meta[property^="og:"]', { element: (el) => el.remove() })
    .on('head > meta[name^="twitter:"]', { element: (el) => el.remove() })
    .on('head > link[rel="canonical"]', { element: (el) => el.remove() })
    .on('head > script[type="application/ld+json"]', { element: (el) => el.remove() })
    .on('head', {
      element(el) {
        el.append(headFrag, { html: true });
      },
    });
  return rewriter.transform(response);
}

export function buildSitemap(env: AppEnv, urls: { loc: string; lastmod?: string; changefreq?: string; priority?: number }[]): string {
  const base = env.APP_URL.replace(/\/$/, '');
  const items = urls
    .map((u) => {
      const loc = u.loc.startsWith('http') ? u.loc : base + u.loc;
      const lm = u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '';
      const cf = u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : '';
      const pr = u.priority !== undefined ? `<priority>${u.priority.toFixed(1)}</priority>` : '';
      return `<url><loc>${loc}</loc>${lm}${cf}${pr}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</urlset>`;
}

export function buildRobots(env: AppEnv): string {
  const base = env.APP_URL.replace(/\/$/, '');
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /account',
    'Disallow: /api/',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}
