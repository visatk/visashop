import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { money, formatDate } from '../../lib/format';

interface Coupon {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  minSubtotalCents: number;
  redemptions: number;
  isActive: boolean;
  expiresAt: string | number | Date | null;
}

export default function AdminCoupons() {
  const [items, setItems] = useState<Coupon[]>([]);
  const toast = useToast();

  const load = async () => setItems(await api.get<Coupon[]>('/api/admin/coupons'));
  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const type = String(fd.get('type')) as 'percent' | 'fixed';
    const rawValue = Number(fd.get('value'));
    const value = type === 'fixed' ? Math.round(rawValue * 100) : Math.round(rawValue);
    const expiry = String(fd.get('expiresAt') ?? '');
    try {
      await api.post('/api/admin/coupons', {
        code: String(fd.get('code')).toUpperCase().slice(0, 32),
        type,
        value,
        minSubtotalCents: Math.round(Number(fd.get('min') ?? 0) * 100),
        expiresAt: expiry ? new Date(expiry).toISOString() : null,
      });
      toast.push('Coupon created', 'success');
      form.reset();
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
      <form onSubmit={create} className="card p-4 grid sm:grid-cols-6 gap-2">
        <input className="input" name="code" placeholder="CODE" required maxLength={32} />
        <select className="input" name="type" defaultValue="percent">
          <option value="percent">Percent off</option>
          <option value="fixed">Fixed off (USD)</option>
        </select>
        <input
          className="input"
          name="value"
          type="number"
          min="0.01"
          step="0.01"
          placeholder="Value"
          required
        />
        <input
          className="input"
          name="min"
          type="number"
          min="0"
          step="0.01"
          placeholder="Min subtotal $"
        />
        <input className="input" name="expiresAt" type="datetime-local" />
        <button className="btn-primary">Create</button>
      </form>
      <ul className="card divide-y divide-(--color-border)">
        {items.map((c) => (
          <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono font-bold">{c.code}</div>
              <div className="text-xs text-(--color-muted)">
                {c.type === 'percent' ? `${c.value}% off` : `${money(c.value)} off`} · used {c.redemptions} time(s)
                {c.expiresAt ? ` · expires ${formatDate(c.expiresAt)}` : ''}
                {c.minSubtotalCents > 0 ? ` · min ${money(c.minSubtotalCents)}` : ''}
                {!c.isActive ? ' · inactive' : ''}
              </div>
            </div>
            <button className="text-(--color-danger) text-sm shrink-0" onClick={() => remove(c.id)}>
              Delete
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="p-6 text-(--color-muted) text-sm">No coupons yet.</li>}
      </ul>
    </div>
  );
}
