import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Category, ProductCard as P } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { ShieldCheck, Zap, KeyRound, Headphones, ArrowRight } from 'lucide-react';

export default function Home() {
  const [featured, setFeatured] = useState<P[]>([]);
  const [latest, setLatest] = useState<P[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [a, b, c] = await Promise.all([
          api.get<{ items: P[] }>('/api/products?featured=1&limit=8'),
          api.get<{ items: P[] }>('/api/products?sort=newest&limit=8'),
          api.get<Category[]>('/api/categories'),
        ]);
        if (cancelled) return;
        setFeatured(a.items);
        setLatest(b.items);
        setCategories(c);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(60%_60%_at_30%_20%,var(--color-accent-soft),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 pb-14 sm:pb-20 grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider bg-(--color-accent-soft) text-(--color-accent) px-3 py-1.5 rounded-full">
              <Zap className="w-3.5 h-3.5" /> Crypto checkout · Instant delivery
            </span>
            <h1 className="mt-4 text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05]">
              Premium digital products,<br />
              <span className="text-(--color-accent)">delivered the moment</span> you pay.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-(--color-muted) max-w-xl">
              License keys, premium subscriptions, scripts, and tools. Pay with Bitcoin, Litecoin, USDT and more —
              auto-fulfilled the instant your transaction confirms.
            </p>
            <div className="mt-7 flex gap-3 flex-wrap">
              <Link to="/shop" className="btn-primary">
                Browse the shop <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/c/license-keys" className="btn-secondary">License keys</Link>
            </div>
            <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              {[
                { icon: ShieldCheck, label: 'Genuine keys' },
                { icon: Zap, label: 'Instant delivery' },
                { icon: KeyRound, label: 'Crypto privacy' },
                { icon: Headphones, label: '24/7 support' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-(--color-muted)">
                  <Icon className="w-4 h-4 text-(--color-accent)" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="card aspect-[4/3] grid grid-cols-2 grid-rows-3 gap-3 p-3">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-xl bg-(--color-accent-soft) skeleton" />
                ))
              ) : featured.length > 0 ? (
                Array.from({ length: 6 }).map((_, i) => {
                  const p = featured[i % featured.length];
                  return (
                    <Link
                      key={i}
                      to={`/p/${p.slug}`}
                      className="rounded-xl bg-(--color-accent-soft) p-3 hover:scale-[1.02] transition-transform overflow-hidden"
                    >
                      <div className="text-[10px] uppercase text-(--color-muted) line-clamp-1">{p.category?.name}</div>
                      <div className="font-semibold line-clamp-2 mt-0.5 text-sm">{p.name}</div>
                      <div className="text-(--color-accent) font-bold mt-2 text-sm">${(p.priceCents / 100).toFixed(2)}</div>
                    </Link>
                  );
                })
              ) : (
                <div className="col-span-2 row-span-3 grid place-items-center text-(--color-muted) text-sm">
                  No featured products yet — check back soon.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <h2 className="text-xl sm:text-2xl font-bold mb-5">Shop by category</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {categories.map((c) => (
              <Link
                key={c.id}
                to={`/c/${c.slug}`}
                className="card p-4 sm:p-5 hover:border-(--color-accent) transition-colors flex items-center justify-between gap-3 group"
              >
                <div className="min-w-0">
                  <div className="font-semibold">{c.name}</div>
                  {c.description && (
                    <div className="text-xs text-(--color-muted) mt-1 line-clamp-2">{c.description}</div>
                  )}
                </div>
                <span className="text-(--color-accent) group-hover:translate-x-0.5 transition-transform">→</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Featured */}
      {(loading || featured.length > 0) && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="flex items-end justify-between mb-5 sm:mb-6 gap-2">
            <h2 className="text-xl sm:text-2xl font-bold">Featured products</h2>
            <Link to="/shop?featured=1" className="text-sm text-(--color-accent) font-semibold whitespace-nowrap">
              See all →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="card aspect-[4/5] skeleton" />
                ))
              : featured.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </section>
      )}

      {/* Latest */}
      {(loading || latest.length > 0) && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="flex items-end justify-between mb-5 sm:mb-6 gap-2">
            <h2 className="text-xl sm:text-2xl font-bold">Recently added</h2>
            <Link to="/shop?sort=newest" className="text-sm text-(--color-accent) font-semibold whitespace-nowrap">
              See all →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="card aspect-[4/5] skeleton" />
                ))
              : latest.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </section>
      )}
    </>
  );
}
