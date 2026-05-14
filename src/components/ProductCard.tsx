import { Link } from 'react-router-dom';
import type { ProductCard as P } from '../lib/types';
import { money } from '../lib/format';
import { cart } from '../lib/cart';
import { useToast } from '../contexts/ToastContext';
import { Star, ShoppingCart } from 'lucide-react';
import { cn } from '../lib/utils';

export function Stars({ rating }: { rating: number }) {
  // rating is stored 0..50 (so 47 = 4.7 stars)
  const value = Math.max(0, Math.min(50, rating)) / 10;
  return (
    <div className="flex items-center gap-1 text-amber-500" aria-label={`Rating ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn('w-3.5 h-3.5', value >= i ? 'fill-current' : 'opacity-30')} />
      ))}
      <span className="text-xs text-(--color-muted) ml-1">{value.toFixed(1)}</span>
    </div>
  );
}

export function ProductCard({ p }: { p: P }) {
  const toast = useToast();
  return (
    <article className="card overflow-hidden flex flex-col group">
      <Link to={`/p/${p.slug}`} className="block aspect-video bg-(--color-accent-soft) relative overflow-hidden">
        {p.image ? (
          <img
            src={p.image}
            alt={p.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-(--color-accent) text-3xl font-black">
            {p.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        {p.badge && (
          <span className="absolute top-2 left-2 text-[11px] uppercase tracking-wide bg-(--color-accent) text-(--color-accent-fg) rounded-full px-2 py-0.5">
            {p.badge}
          </span>
        )}
        {!p.inStock && (
          <span className="absolute top-2 right-2 text-[11px] uppercase tracking-wide bg-(--color-danger) text-white rounded-full px-2 py-0.5">
            Out of stock
          </span>
        )}
      </Link>
      <div className="p-4 flex flex-col gap-2 flex-1">
        {p.category && (
          <Link to={`/c/${p.category.slug}`} className="text-[11px] uppercase tracking-wide text-(--color-muted) hover:text-(--color-accent)">
            {p.category.name}
          </Link>
        )}
        <Link to={`/p/${p.slug}`} className="font-semibold leading-snug line-clamp-2 hover:text-(--color-accent)">
          {p.name}
        </Link>
        {p.shortDescription && <p className="text-sm text-(--color-muted) line-clamp-2">{p.shortDescription}</p>}
        <Stars rating={p.rating} />
        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <div>
            <div className="font-bold">{money(p.priceCents)}</div>
            {p.compareAtCents && p.compareAtCents > p.priceCents && (
              <div className="text-xs text-(--color-muted) line-through">{money(p.compareAtCents)}</div>
            )}
          </div>
          <button
            className="btn-primary text-sm flex items-center gap-1.5"
            disabled={!p.inStock}
            onClick={() => {
              cart.add({
                slug: p.slug,
                name: p.name,
                unitPriceCents: p.priceCents,
                image: p.image,
                type: p.type,
                quantity: 1,
              });
              toast.push(`Added ${p.name} to cart`, 'success');
            }}
          >
            <ShoppingCart className="w-4 h-4" /> Add
          </button>
        </div>
      </div>
    </article>
  );
}
