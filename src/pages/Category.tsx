import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Category as Cat, ProductCard as P } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { ChevronRight } from 'lucide-react';

export default function Category() {
  const { slug = '' } = useParams();
  const [items, setItems] = useState<P[]>([]);
  const [cat, setCat] = useState<Cat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    void Promise.all([
      api.get<{ items: P[] }>(`/api/products?category=${encodeURIComponent(slug)}&limit=48`),
      api.get<Cat[]>('/api/categories'),
    ])
      .then(([r, cats]) => {
        if (cancelled) return;
        setItems(r.items);
        setCat(cats.find((c) => c.slug === slug) ?? null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
      <nav className="text-sm text-(--color-muted) mb-2 flex flex-wrap items-center gap-1" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-(--color-accent)">
          Home
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to="/shop" className="hover:text-(--color-accent)">
          Shop
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-(--color-fg)">{cat?.name ?? slug}</span>
      </nav>
      <h1 className="text-3xl font-bold">{cat?.name ?? slug}</h1>
      {cat?.description && <p className="text-(--color-muted) mt-2 max-w-2xl">{cat.description}</p>}
      <div className="mt-8">
        {error ? (
          <div className="card p-10 text-center text-(--color-danger)">{error}</div>
        ) : loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card aspect-[4/5] skeleton" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="font-semibold">No products in this category yet.</p>
            <p className="text-(--color-muted) mt-1 text-sm">Check back soon.</p>
            <Link to="/shop" className="btn-secondary inline-flex mt-4">
              Browse all products
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
            {items.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
