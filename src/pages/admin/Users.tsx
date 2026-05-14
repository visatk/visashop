import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  createdAt: string | number | Date;
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [items, setItems] = useState<UserRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = async () => setItems(await api.get<UserRow[]>('/api/admin/users'));
  useEffect(() => {
    void load();
  }, []);

  const setRole = async (u: UserRow, role: 'user' | 'admin') => {
    if (u.id === me?.id && role === 'user') {
      toast.push('You cannot demote your own admin account.', 'error');
      return;
    }
    if (!confirm(`Change role of ${u.email} to ${role}?`)) return;
    setBusy(u.id);
    try {
      await api.patch(`/api/admin/users/${u.id}`, { role });
      toast.push(`Role updated to ${role}`, 'success');
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Users</h1>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-(--color-accent-soft) text-left text-xs uppercase">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 whitespace-nowrap">Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-t border-(--color-border)">
                  <td className="px-4 py-2 break-all">{u.email}</td>
                  <td className="px-4 py-2">{u.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={u.role === 'admin' ? 'text-(--color-accent) font-semibold' : ''}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-2 text-right">
                    {u.role === 'admin' ? (
                      <button
                        className="text-sm"
                        disabled={busy === u.id || u.id === me?.id}
                        onClick={() => setRole(u, 'user')}
                      >
                        Demote
                      </button>
                    ) : (
                      <button
                        className="text-sm text-(--color-accent)"
                        disabled={busy === u.id}
                        onClick={() => setRole(u, 'admin')}
                      >
                        Promote
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-(--color-muted)">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
