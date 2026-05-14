import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Category } from '../../lib/types';
import { useToast } from '../../contexts/ToastContext';
import { money } from '../../lib/format';

interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  type: string;
  priceCents: number;
  compareAtCents: number | null;
  isActive: boolean;
  isFeatured: boolean;
  category?: Category | null;
}

export default function AdminProducts() {
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const load = async () => {
    const [p, c] = await Promise.all([
      api.get<AdminProduct[]>('/api/admin/products'),
      api.get<Category[]>('/api/admin/categories'),
    ]);
    setItems(p);
    setCategories(c);
  };
  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get('name')),
      slug: String(fd.get('slug') ?? ''),
      type: String(fd.get('type')),
      priceCents: Math.round(Number(fd.get('price')) * 100),
      compareAtCents: fd.get('compareAt') ? Math.round(Number(fd.get('compareAt')) * 100) : null,
      categoryId: String(fd.get('categoryId') || ''),
      shortDescription: String(fd.get('short') ?? ''),
      description: String(fd.get('desc') ?? ''),
      isActive: true,
      isFeatured: fd.get('featured') === 'on',
    };
    try {
      await api.post('/api/admin/products', body);
      toast.push('Product created', 'success');
      setCreating(false);
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this product?')) return;
    await api.delete(`/api/admin/products/${id}`);
    toast.push('Product deleted', 'success');
    await load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>New product</button>
      </div>

      {creating && (
        <form onSubmit={create} className="card p-5 space-y-3 grid sm:grid-cols-2 gap-3">
          <label className="text-sm">Name<input className="input mt-1" name="name" required /></label>
          <label className="text-sm">Slug<input className="input mt-1" name="slug" placeholder="auto" /></label>
          <label className="text-sm">Type
            <select className="input mt-1" name="type" defaultValue="key">
              <option value="key">License key</option>
              <option value="subscription">Subscription</option>
              <option value="script">Script</option>
              <option value="file">File / tool</option>
            </select>
          </label>
          <label className="text-sm">Category
            <select className="input mt-1" name="categoryId" defaultValue="">
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Price (USD)<input className="input mt-1" type="number" step="0.01" min="0" name="price" required /></label>
          <label className="text-sm">Compare-at (USD)<input className="input mt-1" type="number" step="0.01" min="0" name="compareAt" /></label>
          <label className="text-sm sm:col-span-2">Short description<input className="input mt-1" name="short" /></label>
          <label className="text-sm sm:col-span-2">Description<textarea className="input mt-1" name="desc" rows={4} /></label>
          <label className="text-sm flex items-center gap-2"><input type="checkbox" name="featured" /> Featured</label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn-primary">Create</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-(--color-accent-soft) text-left text-xs uppercase">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-(--color-border)">
                <td className="px-4 py-2">
                  <Link to={`/admin/products/${p.id}/keys`} className="font-medium hover:text-(--color-accent)">{p.name}</Link>
                  <div className="text-xs text-(--color-muted)">/p/{p.slug}</div>
                </td>
                <td className="px-4 py-2">{p.type}</td>
                <td className="px-4 py-2">{p.category?.name ?? '—'}</td>
                <td className="px-4 py-2 text-right">{money(p.priceCents)}</td>
                <td className="px-4 py-2">{p.isActive ? 'Active' : 'Hidden'}</td>
                <td className="px-4 py-2 text-right space-x-3">
                  <Link to={`/admin/products/${p.id}/keys`} className="text-(--color-accent)">Keys/Files</Link>
                  <button onClick={() => remove(p.id)} className="text-(--color-danger)">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
