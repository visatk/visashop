import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { OrderDetail } from '../lib/types';
import { CRYPTO_DECIMALS, CRYPTO_LABELS, formatMinorCrypto, money } from '../lib/format';
import { Copy, CheckCircle2, Clock, AlertTriangle, Download, ExternalLink } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

const REFRESH_MS = 6000;
const TERMINAL_STATUSES = new Set(['fulfilled', 'expired', 'cancelled', 'refunded']);

export default function OrderPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function load() {
      try {
        const res = await api.get<OrderDetail>(
          `/api/orders/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`,
        );
        if (cancelled) return;
        setOrder(res);
        if (!TERMINAL_STATUSES.has(res.status)) {
          timer = window.setTimeout(load, REFRESH_MS);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, token]);

  const expectedDisplay = useMemo(() => {
    if (!order?.crypto?.amountMinor || !order?.crypto?.currency) return '';
    const dec = CRYPTO_DECIMALS[order.crypto.currency] ?? 8;
    return formatMinorCrypto(order.crypto.amountMinor, dec);
  }, [order]);

  const receivedDisplay = useMemo(() => {
    if (!order?.crypto?.received || !order?.crypto?.currency) return '';
    const dec = CRYPTO_DECIMALS[order.crypto.currency] ?? 8;
    return formatMinorCrypto(order.crypto.received, dec);
  }, [order]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-20 px-4 text-center">
        <AlertTriangle className="w-10 h-10 mx-auto text-(--color-danger)" />
        <h1 className="text-2xl font-bold mt-4">{error}</h1>
        <Link to="/" className="btn-secondary mt-6 inline-flex">Go home</Link>
      </div>
    );
  }
  if (!order) return <div className="grid place-items-center py-32"><div className="spinner" /></div>;

  const isDone = order.status === 'fulfilled';
  const isExpired = order.status === 'expired';
  const isCancelled = order.status === 'cancelled' || order.status === 'refunded';
  const isPaid = order.status === 'paid';

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold break-all">Order {order.orderNumber}</h1>
          <p className="text-(--color-muted) text-sm mt-1">Placed {new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <StatusPill status={order.status} />
      </header>

      {/* Payment instructions */}
      {!isDone && !isExpired && !isCancelled && !isPaid && order.crypto.address && (
        <section className="card p-5 sm:p-6 mb-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-(--color-accent)" />
            Awaiting payment
          </h2>
          <div className="grid sm:grid-cols-[160px_1fr] gap-5 sm:gap-6 items-start">
            <div className="bg-white p-3 rounded-lg flex items-center justify-center mx-auto sm:mx-0">
              <img
                alt="Payment QR code"
                className="w-36 h-36 sm:w-40 sm:h-40"
                src={qrUrl(order.crypto.address, expectedDisplay, order.crypto.currency ?? 'btc')}
              />
            </div>
            <div className="space-y-3 min-w-0">
              <Field label="Send">
                <div className="flex items-center gap-2 flex-wrap">
                  <strong className="text-lg font-mono">{expectedDisplay}</strong>
                  <span className="text-sm text-(--color-muted)">{order.crypto.currency?.toUpperCase()}</span>
                  <CopyBtn text={expectedDisplay} onCopy={() => toast.push('Amount copied', 'success')} />
                </div>
              </Field>
              <Field label={`To ${CRYPTO_LABELS[order.crypto.currency ?? '']} address`}>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="text-xs sm:text-sm bg-(--color-accent-soft) text-(--color-accent) px-2 py-1.5 rounded break-all min-w-0 flex-1">
                    {order.crypto.address}
                  </code>
                  <CopyBtn text={order.crypto.address ?? ''} onCopy={() => toast.push('Address copied', 'success')} />
                </div>
              </Field>
              <div className="text-xs text-(--color-muted) space-y-1">
                <div>Confirmations: <strong className="text-(--color-fg)">{order.crypto.confirmations} / 1 required</strong></div>
                {order.crypto.received && order.crypto.received !== '0' && (
                  <div>Received: <strong className="text-(--color-fg) font-mono">{receivedDisplay}</strong> {order.crypto.currency?.toUpperCase()}</div>
                )}
                {order.crypto.txHash && (
                  <div className="break-all">Tx: <code className="font-mono">{order.crypto.txHash}</code></div>
                )}
                {order.expiresAt && (
                  <div>Expires: <strong className="text-(--color-fg)">{new Date(order.expiresAt).toLocaleString()}</strong></div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {isPaid && (
        <section className="card p-5 sm:p-6 mb-6 border-2 border-(--color-warning)">
          <h2 className="font-semibold flex items-center gap-2 text-(--color-warning)">
            <Clock className="w-5 h-5" /> Payment received — preparing your delivery
          </h2>
          <p className="text-sm text-(--color-muted) mt-1">
            We're assigning your products. This usually takes a few seconds.
          </p>
        </section>
      )}

      {isDone && (
        <section className="card p-5 sm:p-6 mb-6 border-2 border-(--color-success)">
          <h2 className="font-semibold flex items-center gap-2 text-(--color-success)">
            <CheckCircle2 className="w-5 h-5" /> Payment confirmed — products delivered
          </h2>
          <p className="text-sm text-(--color-muted) mt-1">A copy was emailed to you. Save anything you need below.</p>
        </section>
      )}

      {isExpired && (
        <section className="card p-5 sm:p-6 mb-6 border-2 border-(--color-warning)">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-(--color-warning)" /> This order has expired.
          </h2>
          <p className="text-sm text-(--color-muted) mt-1">
            If you sent funds after expiry contact support and we will reconcile.
          </p>
        </section>
      )}

      {isCancelled && (
        <section className="card p-5 sm:p-6 mb-6 border-2 border-(--color-border)">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-(--color-muted)" /> This order has been {order.status}.
          </h2>
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Items</h2>
        <div className="divide-y divide-(--color-border)">
          {order.items.map((it) => (
            <div key={it.id} className="py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link to={`/p/${it.productSlug}`} className="font-medium hover:text-(--color-accent) break-words">
                  {it.productName}
                </Link>
                <div className="text-xs text-(--color-muted) mt-0.5">
                  {it.productType} · ×{it.quantity}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm">
                {it.deliveredKey && (
                  <code className="bg-(--color-accent-soft) text-(--color-accent) px-2 py-1 rounded font-mono text-xs sm:text-sm break-all max-w-full">
                    {it.deliveredKey}
                  </code>
                )}
                {isDone && (it.productType === 'file' || it.productType === 'script') && (
                  <a
                    href={`/api/orders/${order.id}/download/${it.id}?t=${encodeURIComponent(token)}`}
                    className="btn-secondary text-xs flex items-center gap-1"
                    rel="noopener noreferrer"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                )}
                <span className="font-semibold tabular-nums">{money(it.unitPriceCents * it.quantity)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 ml-auto max-w-xs space-y-1">
          <div className="flex justify-between text-sm">
            <span>Subtotal</span><span className="tabular-nums">{money(order.subtotalCents)}</span>
          </div>
          {order.discountCents > 0 && (
            <div className="flex justify-between text-sm text-(--color-success)">
              <span>Discount</span><span className="tabular-nums">-{money(order.discountCents)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold pt-1 border-t border-(--color-border)">
            <span>Total</span><span className="tabular-nums">{money(order.totalCents)}</span>
          </div>
        </div>
      </section>

      {isDone && order.crypto.txHash && order.crypto.currency && (
        <p className="text-xs text-(--color-muted) text-center mt-6">
          View on blockchain explorer:{' '}
          <a
            className="text-(--color-accent) inline-flex items-center gap-1"
            href={explorerUrl(order.crypto.currency, order.crypto.txHash)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {order.crypto.txHash.slice(0, 12)}… <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-(--color-muted)">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: OrderDetail['status'] }) {
  const map: Record<OrderDetail['status'], string> = {
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    awaiting_payment: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    partial: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    paid: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    fulfilled: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    expired: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    cancelled: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    refunded: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  };
  return (
    <span
      className={
        'text-[11px] px-2.5 py-1 rounded-full font-semibold uppercase tracking-wide whitespace-nowrap ' + map[status]
      }
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function CopyBtn({ text, onCopy }: { text: string; onCopy?: () => void }) {
  return (
    <button
      type="button"
      className="p-1.5 rounded-md hover:bg-(--color-accent-soft) shrink-0"
      onClick={() => {
        if (!text) return;
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(() => onCopy?.());
        } else {
          // Fallback for older browsers / non-secure contexts.
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
            onCopy?.();
          } finally {
            document.body.removeChild(ta);
          }
        }
      }}
      aria-label="Copy"
    >
      <Copy className="w-4 h-4" />
    </button>
  );
}

function qrUrl(address: string, amount: string, currency: string): string {
  const proto = ({ btc: 'bitcoin', ltc: 'litecoin', doge: 'dogecoin', bch: 'bitcoincash' } as Record<string, string>)[currency];
  const target = proto && amount ? `${proto}:${address}?amount=${amount}` : address;
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&qzone=1&data=${encodeURIComponent(target)}`;
}

function explorerUrl(currency: string, tx: string): string {
  switch (currency) {
    case 'btc': return `https://mempool.space/tx/${tx}`;
    case 'ltc': return `https://blockchair.com/litecoin/transaction/${tx}`;
    case 'doge': return `https://blockchair.com/dogecoin/transaction/${tx}`;
    case 'bch': return `https://blockchair.com/bitcoin-cash/transaction/${tx}`;
    case 'eth':
    case 'usdt@eth':
    case 'usdc@eth':
      return `https://etherscan.io/tx/${tx}`;
    case 'trx':
    case 'usdt@trx':
    case 'usdc@trx':
      return `https://tronscan.org/#/transaction/${tx}`;
    case 'bnb':
    case 'usdt@bnb':
    case 'usdc@bnb':
      return `https://bscscan.com/tx/${tx}`;
    default:
      return `#`;
  }
}
