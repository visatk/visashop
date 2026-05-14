import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Category } from '../../lib/types';
import { useToast } from '../../contexts/ToastContext';
import { Pencil, Trash2, X } from 'lucide-react';

interface AdminCategory extends Category {
  sortOrder?: number;
}

export default function AdminCategories() {
  const [items, setItems] = useState<AdminCategory[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const toast = useToast();

  const load = async () => setItems(await api.get<AdminCategory[]>('/api/admin/categories'));
  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post('/api/admin/categories', { name: name.trim() });
      toast.push('Category created', 'success');
      setName('');
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this category? Products in it will be uncategorised.')) return;
    try {
      await api.delete(`/api/admin/categories/${id}`);
      toast.push('Category deleted', 'success');
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  const saveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    try {
      await api.patch(`/api/admin/categories/${editing.id}`, {
        name: String(fd.get('name') ?? ''),
        description: String(fd.get('description') ?? '') || null,
        sortOrder: Number(fd.get('sortOrder') ?? 0),
      });
      toast.push('Category updated', 'success');
      setEditing(null);
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Categories</h1>
      <form onSubmit={create} className="card p-4 flex gap-2">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          maxLength={120}
        />
        <button className="btn-primary" disabled={!name.trim()}>
          Add
        </button>
      </form>
      <ul className="card divide-y divide-(--color-border)">
        {items.map((c) => (
          <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-(--color-muted) font-mono">/c/{c.slug}</div>
              {c.description && (
                <div className="text-xs text-(--color-muted) mt-1 line-clamp-2 max-w-prose">{c.description}</div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                className="p-2 rounded-md hover:bg-(--color-accent-soft)"
                aria-label={`Edit ${c.name}`}
                onClick={() => setEditing(c)}
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                className="p-2 rounded-md hover:bg-(--color-accent-soft) text-(--color-danger)"
                aria-label={`Delete ${c.name}`}
                onClick={() => remove(c.id)}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="p-6 text-(--color-muted) text-sm">No categories yet.</li>}
      </ul>

      {editing && (
        <div className="fixed inset-0 z-40 bg-black/40 grid place-items-center px-4" onClick={() => setEditing(null)}>
          <form
            className="card p-5 w-full max-w-md space-y-3"
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveEdit}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Edit category</h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close"
                className="p-1 -m-1 rounded-md hover:bg-(--color-accent-soft)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block text-sm">
              Name
              <input className="input mt-1" name="name" defaultValue={editing.name} required maxLength={120} />
            </label>
            <label className="block text-sm">
              Description
              <textarea className="input mt-1" name="description" rows={3} defaultValue={editing.description ?? ''} />
            </label>
            <label className="block text-sm">
              Sort order
              <input
                className="input mt-1"
                name="sortOrder"
                type="number"
                defaultValue={editing.sortOrder ?? 0}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
