import { Link } from 'react-router-dom';
import { cart, useCart } from '../lib/cart';
import { money } from '../lib/format';
import { Trash2, ShoppingBag, Minus, Plus } from 'lucide-react';

export default function Cart() {
  const { items, subtotalCents, count } = useCart();

  if (items.length === 0)
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <ShoppingBag className="w-12 h-12 mx-auto text-(--color-accent)" />
        <h1 className="text-2xl font-bold mt-4">Your cart is empty</h1>
        <p className="text-(--color-muted) mt-2">Browse the shop to add some premium digital goodness.</p>
        <Link to="/shop" className="btn-primary inline-flex mt-6">Open the shop</Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Your cart</h1>
        <p className="text-(--color-muted) text-sm mt-1">
          {count} {count === 1 ? 'item' : 'items'}
        </p>
      </header>
      <div className="grid lg:grid-cols-[1fr_360px] gap-6 lg:gap-8 items-start">
        <div className="space-y-3">
          {items.map((it) => (
            <article key={it.slug} className="card p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
              <Link
                to={`/p/${it.slug}`}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-md bg-(--color-accent-soft) grid place-items-center overflow-hidden shrink-0"
              >
                {it.image ? (
                  <img src={it.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-(--color-accent) font-black text-lg">{it.name.slice(0, 2).toUpperCase()}</span>
                )}
              </Link>
              <div className="flex-1 min-w-0">
                <Link to={`/p/${it.slug}`} className="font-semibold line-clamp-2 hover:text-(--color-accent) leading-snug">
                  {it.name}
                </Link>
                <div className="text-xs text-(--color-muted) mt-0.5">{labelForType(it.type)}</div>
                <div className="text-sm font-semibold mt-1.5 sm:hidden">{money(it.unitPriceCents * it.quantity)}</div>
              </div>
              <div className="hidden sm:block font-semibold w-24 text-right">{money(it.unitPriceCents * it.quantity)}</div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="flex items-center gap-1.5 border border-(--color-border) rounded-md">
                  <button
                    aria-label={`Decrease ${it.name}`}
                    className="w-8 h-8 grid place-items-center hover:bg-(--color-accent-soft) rounded-l-md disabled:opacity-30"
                    onClick={() => cart.setQuantity(it.slug, it.quantity - 1)}
                    disabled={it.quantity <= 1}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-7 text-center text-sm tabular-nums">{it.quantity}</span>
                  <button
                    aria-label={`Increase ${it.name}`}
                    className="w-8 h-8 grid place-items-center hover:bg-(--color-accent-soft) rounded-r-md disabled:opacity-30"
                    onClick={() => cart.setQuantity(it.slug, it.quantity + 1)}
                    disabled={it.quantity >= 20}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <button
                  aria-label={`Remove ${it.name}`}
                  className="p-1.5 rounded-md hover:bg-(--color-accent-soft) text-(--color-muted) hover:text-(--color-danger)"
                  onClick={() => cart.remove(it.slug)}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
        <aside className="card p-5 space-y-3 lg:sticky lg:top-24">
          <h2 className="font-semibold">Order summary</h2>
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span className="tabular-nums">{money(subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-sm text-(--color-muted)">
            <span>Discounts &amp; tax</span><span>Calculated at checkout</span>
          </div>
          <div className="flex justify-between text-base font-bold pt-2 border-t border-(--color-border)">
            <span>Total</span>
            <span className="tabular-nums">{money(subtotalCents)}</span>
          </div>
          <Link to="/checkout" className="btn-primary w-full">Proceed to checkout</Link>
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => {
              if (confirm('Empty your cart?')) cart.clear();
            }}
          >
            Clear cart
          </button>
          <Link to="/shop" className="block text-center text-sm text-(--color-muted) hover:text-(--color-accent)">
            ← Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}

function labelForType(t: string): string {
  return (
    {
      key: 'License key',
      subscription: 'Subscription',
      file: 'Downloadable file',
      script: 'Premium script',
    }[t] ?? t
  );
}
