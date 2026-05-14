import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { money } from '../../lib/format';

interface Coupon {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  minSubtotalCents: number;
  redemptions: number;
  isActive: boolean;
}

export default function AdminCoupons() {
  const [items, setItems] = useState<Coupon[]>([]);
  const toast = useToast();
  const load = async () => setItems(await api.get<Coupon[]>('/api/admin/coupons'));
  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api.post('/api/admin/coupons', {
        code: String(fd.get('code')).toUpperCase(),
        type: String(fd.get('type')) as 'percent' | 'fixed',
        value: Number(fd.get('value')),
        minSubtotalCents: Math.round(Number(fd.get('min') ?? 0) * 100),
      });
      toast.push('Coupon created', 'success');
      e.currentTarget.reset();
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete coupon?')) return;
    await api.delete(`/api/admin/coupons/${id}`);
    await load();
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Coupons</h1>
      <form onSubmit={create} className="card p-4 grid sm:grid-cols-5 gap-2">
        <input className="input" name="code" placeholder="CODE" required />
        <select className="input" name="type" defaultValue="percent">
          <option value="percent">Percent (%)</option>
          <option value="fixed">Fixed (cents)</option>
        </select>
        <input className="input" name="value" type="number" min="1" placeholder="Value" required />
        <input className="input" name="min" type="number" min="0" step="0.01" placeholder="Min subtotal $" />
        <button className="btn-primary">Create</button>
      </form>
      <ul className="card divide-y divide-(--color-border)">
        {items.map((c) => (
          <li key={c.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-mono font-bold">{c.code}</div>
              <div className="text-xs text-(--color-muted)">
                {c.type === 'percent' ? `${c.value}% off` : `${money(c.value)} off`} · used {c.redemptions} time(s)
              </div>
            </div>
            <button className="text-(--color-danger) text-sm" onClick={() => remove(c.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
