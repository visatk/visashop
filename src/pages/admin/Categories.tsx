import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Category } from '../../lib/types';
import { useToast } from '../../contexts/ToastContext';

export default function AdminCategories() {
  const [items, setItems] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const toast = useToast();
  const load = async () => setItems(await api.get<Category[]>('/api/admin/categories'));
  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post('/api/admin/categories', { name });
      toast.push('Category created', 'success');
      setName('');
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this category?')) return;
    await api.delete(`/api/admin/categories/${id}`);
    await load();
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Categories</h1>
      <form onSubmit={create} className="card p-4 flex gap-2">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" />
        <button className="btn-primary">Add</button>
      </form>
      <ul className="card divide-y divide-(--color-border)">
        {items.map((c) => (
          <li key={c.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-(--color-muted)">/c/{c.slug}</div>
            </div>
            <button className="text-(--color-danger) text-sm" onClick={() => remove(c.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
