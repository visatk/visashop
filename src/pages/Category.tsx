import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Category as Cat, ProductCard as P } from '../lib/types';
import { ProductCard } from '../components/ProductCard';

export default function Category() {
  const { slug = '' } = useParams();
  const [items, setItems] = useState<P[]>([]);
  const [cat, setCat] = useState<Cat | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      api.get<{ items: P[] }>(`/api/products?category=${encodeURIComponent(slug)}&limit=48`),
      api.get<Cat[]>('/api/categories'),
    ]).then(([r, cats]) => {
      setItems(r.items);
      setCat(cats.find((c) => c.slug === slug) ?? null);
      setLoading(false);
    });
  }, [slug]);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
      <nav className="text-sm text-(--color-muted) mb-2">
        <Link to="/">Home</Link> · <Link to="/shop">Shop</Link> · <span>{cat?.name ?? slug}</span>
      </nav>
      <h1 className="text-3xl font-bold">{cat?.name ?? slug}</h1>
      {cat?.description && <p className="text-(--color-muted) mt-2 max-w-2xl">{cat.description}</p>}
      <div className="mt-8">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card aspect-[4/5] animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="card p-10 text-center">No products in this category yet.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {items.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
