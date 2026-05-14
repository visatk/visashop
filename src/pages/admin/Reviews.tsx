import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { Star } from 'lucide-react';

interface ReviewRow {
  id: string;
  productId: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string | null;
  isApproved: boolean;
}

export default function AdminReviews() {
  const [items, setItems] = useState<ReviewRow[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const toast = useToast();

  const load = async () => setItems(await api.get<ReviewRow[]>('/api/admin/reviews'));
  useEffect(() => {
    void load();
  }, []);

  const visible = items.filter((r) => (filter === 'pending' ? !r.isApproved : true));

  const approve = async (id: string) => {
    try {
      await api.post(`/api/admin/reviews/${id}/approve`);
      toast.push('Review approved', 'success');
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this review?')) return;
    try {
      await api.delete(`/api/admin/reviews/${id}`);
      toast.push('Review deleted', 'success');
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">Reviews</h1>
        <div className="inline-flex border border-(--color-border) rounded-md p-0.5 text-sm">
          {(['pending', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                'px-3 py-1.5 rounded ' +
                (filter === f ? 'bg-(--color-accent-soft) text-(--color-accent) font-semibold' : '')
              }
            >
              {f === 'pending' ? `Pending (${items.filter((r) => !r.isApproved).length})` : 'All'}
            </button>
          ))}
        </div>
      </div>
      <div className="card divide-y divide-(--color-border)">
        {visible.map((r) => (
          <div key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-amber-500 text-sm flex-wrap">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={'w-4 h-4 ' + (r.rating > i ? 'fill-current' : 'opacity-30')} />
                ))}
                {r.title && <span className="text-(--color-fg) font-semibold">{r.title}</span>}
                {!r.isApproved && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-(--color-warning)/20 text-(--color-warning)">
                    Pending
                  </span>
                )}
              </div>
              {r.body && <p className="text-sm mt-1 whitespace-pre-line break-words">{r.body}</p>}
              <p className="text-xs text-(--color-muted) mt-1">
                By {r.authorName} · product <code className="font-mono">{r.productId}</code>
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {!r.isApproved && (
                <button className="btn-secondary text-sm" onClick={() => approve(r.id)}>
                  Approve
                </button>
              )}
              <button className="text-(--color-danger) text-sm" onClick={() => remove(r.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {visible.length === 0 && <div className="p-6 text-(--color-muted) text-sm">No reviews to show.</div>}
      </div>
    </div>
  );
}
