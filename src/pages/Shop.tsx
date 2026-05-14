import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Category, ProductCard as P } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../lib/utils';

export default function Shop() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'recommended';
  const type = params.get('type') ?? '';
  const featured = params.get('featured') === '1';

  const [items, setItems] = useState<P[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const queryStr = useMemo(() => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (category) u.set('category', category);
    if (sort) u.set('sort', sort);
    if (type) u.set('type', type);
    if (featured) u.set('featured', '1');
    u.set('limit', '24');
    return u.toString();
  }, [q, category, sort, type, featured]);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    void Promise.all([
      api.get<{ items: P[]; total: number }>('/api/products?' + queryStr),
      api.get<Category[]>('/api/categories'),
    ])
      .then(([r, cats]) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
        setCategories(cats);
      })
      .catch((e) => {
        if (!cancelled) console.error(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryStr]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const FilterPanel = (
    <div className="space-y-6">
      <section>
        <h3 className="font-semibold mb-2 text-sm uppercase tracking-wider text-(--color-muted)">Category</h3>
        <ul className="space-y-1 text-sm">
          <li>
            <button
              className={cn(
                'w-full text-left px-2.5 py-1.5 rounded',
                !category ? 'bg-(--color-accent-soft) text-(--color-accent) font-semibold' : 'hover:bg-(--color-accent-soft)/50',
              )}
              onClick={() => update('category', '')}
            >
              All
            </button>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <button
                className={cn(
                  'w-full text-left px-2.5 py-1.5 rounded',
                  category === c.slug ? 'bg-(--color-accent-soft) text-(--color-accent) font-semibold' : 'hover:bg-(--color-accent-soft)/50',
                )}
                onClick={() => update('category', c.slug)}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-semibold mb-2 text-sm uppercase tracking-wider text-(--color-muted)">Type</h3>
        <ul className="space-y-1 text-sm">
          {[
            { v: '', l: 'All types' },
            { v: 'key', l: 'License key' },
            { v: 'subscription', l: 'Subscription' },
            { v: 'script', l: 'Script' },
            { v: 'file', l: 'File / tool' },
          ].map((opt) => (
            <li key={opt.v}>
              <button
                className={cn(
                  'w-full text-left px-2.5 py-1.5 rounded',
                  type === opt.v ? 'bg-(--color-accent-soft) text-(--color-accent) font-semibold' : 'hover:bg-(--color-accent-soft)/50',
                )}
                onClick={() => update('type', opt.v)}
              >
                {opt.l}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-semibold mb-2 text-sm uppercase tracking-wider text-(--color-muted)">Sort</h3>
        <select
          className="input text-sm"
          value={sort}
          onChange={(e) => update('sort', e.target.value)}
          aria-label="Sort products"
        >
          <option value="recommended">Recommended</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="rating">Top rated</option>
        </select>
      </section>
      {(category || type || featured || q) && (
        <button
          onClick={() => setParams(new URLSearchParams(), { replace: true })}
          className="text-xs text-(--color-accent) underline-offset-4 hover:underline"
        >
          Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Shop</h1>
        <p className="text-(--color-muted) mt-1 text-sm">
          {loading ? 'Loading…' : `${total} ${total === 1 ? 'product' : 'products'} available`}
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          update('q', String(fd.get('q') ?? ''));
        }}
        className="card flex items-center gap-2 px-3 py-1 mb-4"
      >
        <Search className="w-4 h-4 opacity-60" aria-hidden />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search products"
          className="bg-transparent outline-none flex-1 py-2 min-w-0"
          aria-label="Search products"
        />
        <button className="btn-primary text-sm" type="submit">Search</button>
      </form>

      <div className="lg:hidden mb-4">
        <button
          onClick={() => setFiltersOpen(true)}
          className="btn-secondary w-full flex items-center justify-center gap-2"
        >
          <SlidersHorizontal className="w-4 h-4" /> Filters
        </button>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-8">
        <aside className="hidden lg:block space-y-6 sticky top-24 self-start">{FilterPanel}</aside>

        <section>
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card aspect-[4/5] skeleton" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="font-semibold">No products match your filters.</p>
              <p className="text-sm text-(--color-muted) mt-1">Try clearing the search or selecting a different category.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
              {items.map((p) => (
                <ProductCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Mobile filters drawer */}
      {filtersOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/40 flex items-end" onClick={() => setFiltersOpen(false)}>
          <div
            className="bg-(--color-card) w-full rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Filters</h2>
              <button
                onClick={() => setFiltersOpen(false)}
                className="p-1 -m-1 rounded-md hover:bg-(--color-accent-soft)"
                aria-label="Close filters"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {FilterPanel}
            <button onClick={() => setFiltersOpen(false)} className="btn-primary w-full mt-6">
              View {total} products
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
