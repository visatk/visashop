import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { money, formatDate } from '../lib/format';
import { useToast } from '../contexts/ToastContext';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  totalCents: number;
  cryptoCurrency: string | null;
  createdAt: string;
  fulfilledAt: string | null;
}

function AccountHome() {
  const { user } = useAuth();
  return (
    <div className="card p-6">
      <h2 className="text-xl font-semibold mb-1">Welcome back{user?.name ? ', ' + user.name : ''}</h2>
      <p className="text-(--color-muted) text-sm">Manage your orders, profile and downloads from here.</p>
    </div>
  );
}

function Orders() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<OrderRow[]>('/api/account/orders')
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="card p-8 grid place-items-center">
        <div className="spinner" />
      </div>
    );
  }
  if (error) {
    return <div className="card p-6 text-(--color-danger)">{error}</div>;
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-5 border-b border-(--color-border) font-semibold">My orders</div>
      {rows.length === 0 ? (
        <div className="p-8 text-(--color-muted) text-center">You haven’t placed any orders yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-(--color-accent-soft) text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-(--color-border)">
                  <td className="px-4 py-3 font-mono">{r.orderNumber}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-3">{r.status.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.totalCents, r.currency)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/orders/${r.id}`} className="text-(--color-accent) font-semibold">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [currentPassword, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card p-6 space-y-4 max-w-md"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api.patch('/api/account/profile', {
            name,
            currentPassword: password ? currentPassword : undefined,
            password: password || undefined,
          });
          await refresh();
          setPassword('');
          setCurrent('');
          toast.push('Profile updated', 'success');
        } catch (err) {
          toast.push((err as Error).message, 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-semibold">Profile</h2>
      <label className="block text-sm">
        Email
        <input className="input mt-1" value={user?.email ?? ''} disabled autoComplete="email" />
      </label>
      <label className="block text-sm">
        Name
        <input
          className="input mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={80}
        />
      </label>
      <h3 className="font-semibold pt-2">Change password</h3>
      <label className="block text-sm">
        Current password
        <input
          type="password"
          className="input mt-1"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      <label className="block text-sm">
        New password
        <input
          type="password"
          className="input mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
        />
      </label>
      <button className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

export default function Account() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid place-items-center py-32">
        <div className="spinner" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: '/account' }} />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-10 grid lg:grid-cols-[220px_1fr] gap-8">
      <aside>
        <h1 className="text-xl font-bold mb-4">My account</h1>
        <nav className="flex lg:flex-col gap-1 text-sm" aria-label="Account navigation">
          {[
            { to: '/account', label: 'Overview', end: true },
            { to: '/account/orders', label: 'Orders' },
            { to: '/account/profile', label: 'Profile' },
          ].map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                'px-3 py-2 rounded-md ' +
                (isActive
                  ? 'bg-(--color-accent-soft) text-(--color-accent) font-semibold'
                  : 'hover:bg-(--color-accent-soft)/50')
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div>
        <Routes>
          <Route index element={<AccountHome />} />
          <Route path="orders" element={<Orders />} />
          <Route path="profile" element={<Profile />} />
        </Routes>
      </div>
    </div>
  );
}
