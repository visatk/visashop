import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Category } from '../../lib/types';
import { useToast } from '../../contexts/ToastContext';
import { money } from '../../lib/format';
import { Trash2, Pencil, Plus } from 'lucide-react';

interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  type: 'key' | 'file' | 'subscription' | 'script';
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
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => {
    const [p, c] = await Promise.all([
      api.get<AdminProduct[]>('/api/admin/products'),
      api.get<Category[]>('/api/admin/categories'),
    ]);
    setItems(p);
    setCategories(c);
  };
  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const compareAtRaw = fd.get('compareAt');
    const compareAtCents =
      compareAtRaw && String(compareAtRaw).trim()
        ? Math.round(Number(compareAtRaw) * 100)
        : null;
    const categoryId = String(fd.get('categoryId') ?? '');
    const body = {
      name: String(fd.get('name') ?? '').trim(),
      slug: String(fd.get('slug') ?? '').trim(),
      type: String(fd.get('type') ?? 'key') as AdminProduct['type'],
      priceCents: Math.round(Number(fd.get('price')) * 100),
      compareAtCents,
      categoryId: categoryId || null,
      shortDescription: String(fd.get('short') ?? '').trim() || null,
      description: String(fd.get('desc') ?? '').trim() || null,
      isActive: true,
      isFeatured: fd.get('featured') === 'on',
    };
    try {
      await api.post('/api/admin/products', body);
      toast.push('Product created', 'success');
      form.reset();
      setCreating(false);
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async (p: AdminProduct) => {
    try {
      await api.patch(`/api/admin/products/${p.id}`, { isActive: !p.isActive });
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this product? License keys and files will also be removed.')) return;
    try {
      await api.delete(`/api/admin/products/${id}`);
      toast.push('Product deleted', 'success');
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
          <Plus className="w-4 h-4" /> New product
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="card p-5 grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            Name
            <input className="input mt-1" name="name" required maxLength={200} />
          </label>
          <label className="text-sm">
            Slug
            <input className="input mt-1" name="slug" placeholder="auto" maxLength={80} />
          </label>
          <label className="text-sm">
            Type
            <select className="input mt-1" name="type" defaultValue="key">
              <option value="key">License key</option>
              <option value="subscription">Subscription</option>
              <option value="script">Script</option>
              <option value="file">File / tool</option>
            </select>
          </label>
          <label className="text-sm">
            Category
            <select className="input mt-1" name="categoryId" defaultValue="">
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Price (USD)
            <input
              className="input mt-1"
              type="number"
              step="0.01"
              min="0"
              name="price"
              required
            />
          </label>
          <label className="text-sm">
            Compare-at (USD)
            <input className="input mt-1" type="number" step="0.01" min="0" name="compareAt" />
          </label>
          <label className="text-sm sm:col-span-2">
            Short description
            <input className="input mt-1" name="short" maxLength={240} />
          </label>
          <label className="text-sm sm:col-span-2">
            Description
            <textarea className="input mt-1" name="desc" rows={4} />
          </label>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" name="featured" /> Featured on the homepage
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
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
                    <Link to={`/admin/products/${p.id}/keys`} className="font-medium hover:text-(--color-accent)">
                      {p.name}
                    </Link>
                    <div className="text-xs text-(--color-muted)">/p/{p.slug}</div>
                  </td>
                  <td className="px-4 py-2">{p.type}</td>
                  <td className="px-4 py-2">{p.category?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {money(p.priceCents)}
                    {p.compareAtCents && (
                      <div className="text-xs text-(--color-muted) line-through">{money(p.compareAtCents)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      className={
                        'text-xs px-2 py-0.5 rounded-full font-semibold ' +
                        (p.isActive
                          ? 'bg-(--color-success)/15 text-(--color-success)'
                          : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300')
                      }
                      onClick={() => togglePublished(p)}
                      aria-label={p.isActive ? 'Unpublish' : 'Publish'}
                    >
                      {p.isActive ? 'Active' : 'Hidden'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        to={`/admin/products/${p.id}/keys`}
                        className="p-2 rounded-md hover:bg-(--color-accent-soft) text-(--color-accent)"
                        aria-label="Manage inventory"
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => remove(p.id)}
                        className="p-2 rounded-md hover:bg-(--color-accent-soft) text-(--color-danger)"
                        aria-label="Delete product"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-(--color-muted)">
                    No products yet — click "New product" above.
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
