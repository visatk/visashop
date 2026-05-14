import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/format';

interface UserRow { id: string; email: string; name: string | null; role: 'user' | 'admin'; createdAt: string | number | Date }

export default function AdminUsers() {
  const [items, setItems] = useState<UserRow[]>([]);
  const toast = useToast();
  const load = async () => setItems(await api.get<UserRow[]>('/api/admin/users'));
  useEffect(() => { void load(); }, []);

  const setRole = async (id: string, role: 'user' | 'admin') => {
    await api.patch(`/api/admin/users/${id}`, { role });
    toast.push(`Role updated to ${role}`, 'success');
    await load();
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Users</h1>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-(--color-accent-soft) text-left text-xs uppercase">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-t border-(--color-border)">
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.name ?? '—'}</td>
                <td className="px-4 py-2">
                  <span className={u.role === 'admin' ? 'text-(--color-accent) font-semibold' : ''}>{u.role}</span>
                </td>
                <td className="px-4 py-2">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  {u.role === 'admin' ? (
                    <button className="text-sm" onClick={() => setRole(u.id, 'user')}>Demote</button>
                  ) : (
                    <button className="text-sm text-(--color-accent)" onClick={() => setRole(u.id, 'admin')}>Promote</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
