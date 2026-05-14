import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
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
  const load = async () => setItems(await api.get<ReviewRow[]>('/api/admin/reviews'));
  useEffect(() => { void load(); }, []);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Reviews</h1>
      <div className="card divide-y divide-(--color-border)">
        {items.map((r) => (
          <div key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-amber-500 text-sm">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={'w-4 h-4 ' + (r.rating > i ? 'fill-current' : 'opacity-30')} />
                ))}
                <span className="text-(--color-fg) font-semibold">{r.title ?? '—'}</span>
                {!r.isApproved && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-(--color-warning)/20 text-(--color-warning)">Pending</span>}
              </div>
              <p className="text-sm mt-1">{r.body}</p>
              <p className="text-xs text-(--color-muted) mt-1">By {r.authorName}</p>
            </div>
            <div className="flex gap-2">
              {!r.isApproved && (
                <button
                  className="btn-secondary text-sm"
                  onClick={async () => {
                    await api.post(`/api/admin/reviews/${r.id}/approve`);
                    await load();
                  }}
                >Approve</button>
              )}
              <button
                className="text-(--color-danger) text-sm"
                onClick={async () => {
                  await api.delete(`/api/admin/reviews/${r.id}`);
                  await load();
                }}
              >Delete</button>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="p-6 text-(--color-muted) text-sm">No reviews yet.</div>}
      </div>
    </div>
  );
}
