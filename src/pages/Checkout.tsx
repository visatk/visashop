import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { cart, useCart } from '../lib/cart';
import { useAuth } from '../contexts/AuthContext';
import { CRYPTO_LABELS, money } from '../lib/format';
import { useToast } from '../contexts/ToastContext';
import { Lock, Tag, Bitcoin } from 'lucide-react';

interface Quote {
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  couponValid: boolean;
  cryptoQuote: {
    currency: string;
    decimals: number;
    amountStr: string;
    amountDisplay: string;
    fiatPerCrypto: number;
  } | null;
}

interface CheckoutResponse {
  orderId: string;
  orderNumber: string;
  payUrl: string;
  orderToken: string;
}

const CRYPTOS = ['btc', 'ltc', 'doge', 'trx', 'usdt@trx', 'usdc@trx', 'eth', 'usdt@eth', 'usdc@eth'];

export default function Checkout() {
  const { user } = useAuth();
  const { items, subtotalCents } = useCart();
  const navigate = useNavigate();
  const toast = useToast();

  const [email, setEmail] = useState(user?.email ?? '');
  const [crypto, setCrypto] = useState('btc');
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (user?.email) setEmail(user.email);
  }, [user?.email]);

  useEffect(() => {
    if (items.length === 0) return;
    const handle = setTimeout(() => {
      setLoading(true);
      void api
        .post<Quote>('/api/checkout/quote', {
          items: items.map((i) => ({ slug: i.slug, quantity: i.quantity })),
          cryptoCurrency: crypto,
          couponCode: coupon || undefined,
        })
        .then(setQuote)
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [items, crypto, coupon]);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-20 text-center px-4">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <p className="text-(--color-muted) mt-2">Add a product before heading to checkout.</p>
        <Link to="/shop" className="btn-primary mt-6 inline-flex">Open the shop</Link>
      </div>
    );
  }

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (placing) return;
    setPlacing(true);
    try {
      const res = await api.post<CheckoutResponse>('/api/checkout', {
        items: items.map((i) => ({ slug: i.slug, quantity: i.quantity })),
        cryptoCurrency: crypto,
        couponCode: coupon || undefined,
        email,
      });
      cart.clear();
      navigate(`/orders/${res.orderId}?t=${encodeURIComponent(res.orderToken)}`);
    } catch (err) {
      toast.push((err as Error).message, 'error');
    } finally {
      setPlacing(false);
    }
  };

  const subtotal = quote?.subtotalCents ?? subtotalCents;
  const discount = quote?.discountCents ?? 0;
  const total = quote?.totalCents ?? subtotalCents;

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
      <h1 className="text-3xl font-bold mb-1">Checkout</h1>
      <p className="text-sm text-(--color-muted) mb-6 flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> Encrypted, no card data ever stored.
      </p>
      <form onSubmit={placeOrder} className="grid lg:grid-cols-[1fr_360px] gap-6 lg:gap-8 items-start">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold mb-3">Contact</h2>
            <label className="block text-sm">
              Email
              <input
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input mt-1"
                autoComplete="email"
              />
            </label>
            <p className="text-xs text-(--color-muted) mt-2">
              We will email your license keys / downloads to this address.{' '}
              {!user && (
                <>
                  <Link to="/login" className="text-(--color-accent)">Sign in</Link> to track this order in your account.
                </>
              )}
            </p>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <Bitcoin className="w-4 h-4 text-(--color-accent)" />
              Pay with cryptocurrency
            </h2>
            <p className="text-xs text-(--color-muted) mb-3">
              Choose a network. Your order is auto-fulfilled the moment your transaction reaches one network confirmation.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CRYPTOS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setCrypto(c)}
                  className={
                    'border rounded-lg px-3 py-2 text-sm text-left transition ' +
                    (crypto === c
                      ? 'border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent) font-semibold'
                      : 'border-(--color-border) hover:border-(--color-accent)/50')
                  }
                >
                  {CRYPTO_LABELS[c]}
                </button>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Tag className="w-4 h-4 text-(--color-accent)" />
              Coupon (optional)
            </h2>
            <div className="flex gap-2">
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase().slice(0, 32))}
                className="input"
                placeholder="WELCOME10"
                aria-label="Coupon code"
              />
            </div>
            {coupon && quote && (
              <p
                className={
                  'text-xs mt-2 ' +
                  (quote.couponValid ? 'text-(--color-success)' : 'text-(--color-danger)')
                }
              >
                {quote.couponValid ? '✔ Coupon applied!' : '✗ Coupon not valid for this order.'}
              </p>
            )}
          </section>
        </div>

        <aside className="card p-5 space-y-3 lg:sticky lg:top-24">
          <h2 className="font-semibold">Order summary</h2>
          <div className="space-y-2 text-sm">
            {items.map((it) => (
              <div key={it.slug} className="flex justify-between gap-2">
                <span className="line-clamp-1 flex-1">
                  {it.name} <span className="text-(--color-muted)">× {it.quantity}</span>
                </span>
                <span className="tabular-nums shrink-0">{money(it.unitPriceCents * it.quantity)}</span>
              </div>
            ))}
          </div>
          <hr className="border-(--color-border)" />
          <div className="text-sm flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
          {discount > 0 && (
            <div className="text-sm flex justify-between text-(--color-success)">
              <span>Discount</span><span className="tabular-nums">-{money(discount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg">
            <span>Total</span><span className="tabular-nums">{money(total)}</span>
          </div>
          {quote?.cryptoQuote && (
            <div className="rounded-lg bg-(--color-accent-soft) text-(--color-accent) px-3 py-2.5 text-sm">
              <div>
                ≈ <strong className="font-mono">{quote.cryptoQuote.amountDisplay}</strong>{' '}
                {quote.cryptoQuote.currency.toUpperCase()}
              </div>
              <div className="text-xs opacity-80 mt-0.5">
                @ ${quote.cryptoQuote.fiatPerCrypto.toLocaleString(undefined, { maximumFractionDigits: 2 })}/
                {quote.cryptoQuote.currency.toUpperCase()}
              </div>
            </div>
          )}
          <button className="btn-primary w-full" disabled={placing || loading || !email}>
            {placing ? <><span className="spinner" /> Creating order…</> : 'Place order'}
          </button>
          <p className="text-xs text-(--color-muted)">
            By placing this order you agree to our{' '}
            <Link to="/help" className="hover:text-(--color-accent)">Terms</Link> and acknowledge our refund policy.
          </p>
        </aside>
      </form>
    </div>
  );
}
