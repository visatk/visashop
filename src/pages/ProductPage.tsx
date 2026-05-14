import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { ProductDetail } from '../lib/types';
import { Stars } from '../components/ProductCard';
import { money } from '../lib/format';
import { cart } from '../lib/cart';
import { useToast } from '../contexts/ToastContext';
import { CheckCircle2, Clock4, ShieldCheck, Zap, ShoppingCart, Star, ChevronRight } from 'lucide-react';

export default function ProductPage() {
  const { slug = '' } = useParams();
  const [p, setP] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewBody, setReviewBody] = useState({ title: '', body: '', rating: 5 });
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    setP(null);
    setError(null);
    setQty(1);
    let cancelled = false;
    void api
      .get<ProductDetail>(`/api/products/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!cancelled) setP(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error)
    return (
      <div className="mx-auto max-w-3xl py-20 px-4 text-center">
        <h1 className="text-2xl font-bold">{error}</h1>
        <Link to="/shop" className="btn-primary mt-6 inline-flex">Back to shop</Link>
      </div>
    );
  if (!p)
    return (
      <div className="mx-auto max-w-7xl px-4 py-20 grid place-items-center">
        <div className="spinner" />
      </div>
    );

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post(`/api/products/${encodeURIComponent(slug)}/reviews`, reviewBody);
      toast.push('Thanks! Your review will appear after approval.', 'success');
      setReviewBody({ title: '', body: '', rating: 5 });
    } catch (err) {
      toast.push((err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
      <nav className="text-sm text-(--color-muted) mb-4 flex flex-wrap items-center gap-1" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-(--color-accent)">Home</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to="/shop" className="hover:text-(--color-accent)">Shop</Link>
        {p.category && (
          <>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link to={`/c/${p.category.slug}`} className="hover:text-(--color-accent)">{p.category.name}</Link>
          </>
        )}
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-(--color-fg) line-clamp-1">{p.name}</span>
      </nav>

      <div className="grid lg:grid-cols-2 gap-8 lg:gap-10">
        <div className="card aspect-square grid place-items-center bg-(--color-accent-soft) overflow-hidden">
          {p.image ? (
            <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-6xl font-black text-(--color-accent)">{p.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div>
          {p.category && (
            <Link to={`/c/${p.category.slug}`} className="text-xs uppercase tracking-wider text-(--color-muted) hover:text-(--color-accent)">
              {p.category.name}
            </Link>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold mt-1 break-words">{p.name}</h1>
          <div className="mt-2 flex items-center gap-3">
            <Stars rating={p.rating} />
            {p.reviews.length > 0 && (
              <span className="text-xs text-(--color-muted)">· {p.reviews.length} reviews</span>
            )}
          </div>
          <div className="mt-4 flex items-baseline gap-3 flex-wrap">
            <div className="text-3xl font-black tabular-nums">{money(p.priceCents)}</div>
            {p.compareAtCents && p.compareAtCents > p.priceCents && (
              <>
                <div className="text-(--color-muted) line-through tabular-nums">{money(p.compareAtCents)}</div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-(--color-success)/15 text-(--color-success) font-semibold">
                  Save {Math.round(((p.compareAtCents - p.priceCents) / p.compareAtCents) * 100)}%
                </span>
              </>
            )}
            {!p.inStock && <span className="text-sm text-(--color-danger) font-semibold">Out of stock</span>}
          </div>

          {p.shortDescription && <p className="mt-5 text-(--color-muted) max-w-prose">{p.shortDescription}</p>}

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <Feature icon={Zap} label="Instant delivery" />
            <Feature icon={CheckCircle2} label="Genuine product" />
            <Feature icon={ShieldCheck} label="Secure checkout" />
            <Feature icon={Clock4} label="24/7 support" />
          </div>

          <div className="mt-7 flex items-center gap-3 flex-wrap">
            <div className="flex items-center border border-(--color-border) rounded-md overflow-hidden">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="px-3 py-2 hover:bg-(--color-accent-soft)"
                disabled={qty <= 1}
              >−</button>
              <span className="w-10 text-center tabular-nums">{qty}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQty((q) => Math.min(20, q + 1))}
                className="px-3 py-2 hover:bg-(--color-accent-soft)"
                disabled={qty >= 20}
              >+</button>
            </div>
            <button
              className="btn-primary"
              disabled={!p.inStock}
              onClick={() => {
                cart.add({
                  slug: p.slug,
                  name: p.name,
                  unitPriceCents: p.priceCents,
                  image: p.image,
                  type: p.type,
                  quantity: qty,
                });
                toast.push(`Added ${qty} × ${p.name} to cart`, 'success');
              }}
            >
              <ShoppingCart className="w-4 h-4" /> Add to cart
            </button>
            <Link
              to="/checkout"
              onClick={() => {
                if (!p.inStock) return;
                cart.add({
                  slug: p.slug,
                  name: p.name,
                  unitPriceCents: p.priceCents,
                  image: p.image,
                  type: p.type,
                  quantity: qty,
                });
              }}
              className="btn-secondary"
            >
              Buy now
            </Link>
          </div>
          {p.durationDays && (
            <p className="mt-3 text-xs text-(--color-muted)">
              Subscription duration: {p.durationDays} days from delivery.
            </p>
          )}
        </div>
      </div>

      {p.description && (
        <section className="mt-10 sm:mt-12 max-w-3xl">
          <h2 className="text-xl font-bold mb-3">About this product</h2>
          <p className="text-(--color-fg) leading-relaxed whitespace-pre-line">{p.description}</p>
        </section>
      )}

      <section className="mt-10 sm:mt-12">
        <h2 className="text-xl font-bold mb-4">Reviews</h2>
        <div className="grid lg:grid-cols-[1fr_320px] gap-6 lg:gap-8 items-start">
          <div>
            {p.reviews.length === 0 ? (
              <div className="card p-6 text-(--color-muted)">
                No reviews yet — be the first to share your experience.
              </div>
            ) : (
              <div className="space-y-3">
                {p.reviews.map((r) => (
                  <div key={r.id} className="card p-4">
                    <div className="flex items-center gap-2 text-amber-500">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={'w-4 h-4 ' + (r.rating > i ? 'fill-current' : 'opacity-30')} />
                      ))}
                      {r.title && <span className="text-sm font-semibold ml-1 text-(--color-fg)">{r.title}</span>}
                    </div>
                    {r.body && <p className="mt-2 text-sm whitespace-pre-line">{r.body}</p>}
                    <div className="text-xs text-(--color-muted) mt-2">By {r.authorName}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={submitReview} className="card p-5 space-y-3 lg:sticky lg:top-24">
            <h3 className="font-semibold">Write a review</h3>
            <label className="block text-sm">
              Rating
              <select
                value={reviewBody.rating}
                onChange={(e) => setReviewBody((r) => ({ ...r, rating: Number(e.target.value) }))}
                className="input mt-1"
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Title
              <input
                value={reviewBody.title}
                onChange={(e) => setReviewBody((r) => ({ ...r, title: e.target.value }))}
                className="input mt-1"
                placeholder="A great experience…"
                maxLength={120}
              />
            </label>
            <label className="block text-sm">
              Review
              <textarea
                value={reviewBody.body}
                onChange={(e) => setReviewBody((r) => ({ ...r, body: e.target.value }))}
                className="input mt-1 min-h-[120px]"
                placeholder="Share what you liked or improvements you'd suggest"
                maxLength={4000}
              />
            </label>
            <button className="btn-primary w-full" disabled={submitting || !reviewBody.body.trim()}>
              {submitting ? <><span className="spinner" /> Submitting…</> : 'Submit review'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function Feature({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="card p-2.5 sm:p-3 flex items-center gap-2">
      <Icon className="w-4 h-4 text-(--color-accent) shrink-0" />
      <span className="line-clamp-1">{label}</span>
    </div>
  );
}
