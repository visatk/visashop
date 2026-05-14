import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { money, formatDate } from '../../lib/format';

interface Stats {
  productCount: number;
  userCount: number;
  orderCount: number;
  revenueCents: number;
  revenueLast30Cents: number;
  recentOrders: {
    id: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    currency: string;
    createdAt: string | number | Date;
  }[];
  lowStock: { id: string; name: string; slug: string; available: number }[];
}

export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<Stats>('/api/admin/stats')
      .then((r) => {
        if (!cancelled) setS(r);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="card p-6">
        <h1 className="text-2xl font-bold mb-2">Dashboard</h1>
        <p className="text-(--color-danger)">{error}</p>
      </div>
    );
  }
  if (!s) {
    return (
      <div className="grid place-items-center py-32">
        <div className="spinner" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Tile label="Revenue (all time)" value={money(s.revenueCents)} />
        <Tile label="Revenue (30d)" value={money(s.revenueLast30Cents)} />
        <Tile label="Orders" value={String(s.orderCount)} />
        <Tile label="Customers" value={String(s.userCount)} />
      </div>
      <section className="card overflow-hidden">
        <div className="p-4 font-semibold border-b border-(--color-border)">Recent orders</div>
        {s.recentOrders.length === 0 ? (
          <div className="p-8 text-(--color-muted) text-sm text-center">No orders yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-(--color-accent-soft) text-left text-xs uppercase">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {s.recentOrders.map((o) => (
                  <tr key={o.id} className="border-t border-(--color-border)">
                    <td className="px-4 py-2 font-mono">{o.orderNumber}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(o.createdAt)}</td>
                    <td className="px-4 py-2">{o.status.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(o.totalCents, o.currency)}</td>
                    <td className="px-4 py-2 text-right">
                      <Link to={`/admin/orders/${o.id}`} className="text-(--color-accent)">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card p-5">
        <div className="font-semibold mb-3">Low stock alerts</div>
        {s.lowStock.length === 0 ? (
          <div className="text-(--color-muted) text-sm">All products are well stocked.</div>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {s.lowStock.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 items-center">
                <Link to={`/admin/products/${p.id}/keys`} className="hover:text-(--color-accent) min-w-0 truncate">
                  {p.name}
                </Link>
                <span
                  className={
                    'font-semibold tabular-nums shrink-0 ' +
                    (p.available === 0 ? 'text-(--color-danger)' : 'text-(--color-warning)')
                  }
                >
                  {p.available} left
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-(--color-muted)">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
    </div>
  );
}
