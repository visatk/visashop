import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { money, formatDate } from '../../lib/format';
import { useToast } from '../../contexts/ToastContext';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  email: string;
  totalCents: number;
  currency: string;
  createdAt: string | number | Date;
  cryptoCurrency: string | null;
  cryptoAddress: string | null;
}

export function AdminOrders() {
  const [items, setItems] = useState<OrderRow[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    void api.get<OrderRow[]>(`/api/admin/orders${status ? `?status=${status}` : ''}`).then(setItems);
  }, [status]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Orders</h1>
        <select className="input max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="awaiting_payment">Awaiting payment</option>
          <option value="paid">Paid</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-(--color-accent-soft) text-left text-xs uppercase">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id} className="border-t border-(--color-border)">
                <td className="px-4 py-2 font-mono">{o.orderNumber}</td>
                <td className="px-4 py-2">{o.email}</td>
                <td className="px-4 py-2">{formatDate(o.createdAt)}</td>
                <td className="px-4 py-2">{o.status.replace(/_/g, ' ')}</td>
                <td className="px-4 py-2 text-right">{money(o.totalCents, o.currency)}</td>
                <td className="px-4 py-2 text-right"><Link to={`/admin/orders/${o.id}`} className="text-(--color-accent)">Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AdminOrderItem {
  id: string;
  productSlug: string;
  productName: string;
  productType: string;
  unitPriceCents: number;
  quantity: number;
  deliveredKey: string | null;
}

interface WorkflowStatusInfo {
  id: string;
  status: string;
  output?: unknown;
  error?: { name: string; message: string };
}

interface AdminOrderDetailRow {
  id: string;
  orderNumber: string;
  status: string;
  email: string;
  totalCents: number;
  currency: string;
  createdAt: string | number | Date;
  cryptoCurrency: string | null;
  cryptoAddress: string | null;
  paymentConfirmations: number;
  paymentTxHash: string | null;
  items: AdminOrderItem[];
}

export function AdminOrderDetail() {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<AdminOrderDetailRow | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowStatusInfo | null>(null);
  const toast = useToast();

  const load = async () => {
    const [o, w] = await Promise.all([
      api.get<AdminOrderDetailRow>(`/api/admin/orders/${id}`),
      api.get<WorkflowStatusInfo>(`/api/admin/orders/${id}/workflow`).catch(() => null),
    ]);
    setOrder(o);
    setWorkflow(w);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!order) return <div className="grid place-items-center py-32"><div className="spinner" /></div>;

  const action = async (path: string, msg: string) => {
    try {
      await api.post(path);
      toast.push(msg, 'success');
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Link to="/admin/orders" className="text-sm text-(--color-accent)">← All orders</Link>
        <h1 className="text-2xl font-bold mt-1">Order {order.orderNumber}</h1>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
        <Info label="Status" value={order.status.replace(/_/g, ' ')} />
        <Info label="Email" value={order.email} />
        <Info label="Created" value={formatDate(order.createdAt)} />
        <Info label="Total" value={money(order.totalCents, order.currency)} />
        <Info label="Crypto" value={order.cryptoCurrency} />
        <Info label="Address" value={order.cryptoAddress} />
        <Info label="Confirmations" value={String(order.paymentConfirmations ?? 0)} />
        <Info label="Tx hash" value={order.paymentTxHash} />
        <Info label="Workflow status" value={workflow?.status ?? '—'} />
      </div>
      {workflow?.error && (
        <div className="card p-3 border-2 border-(--color-danger) text-sm">
          <strong className="text-(--color-danger)">Workflow error:</strong>{' '}
          {workflow.error.name}: {workflow.error.message}
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary" onClick={() => action(`/api/admin/orders/${id}/fulfil`, 'Workflow advanced')}>
          Fulfil now
        </button>
        <button
          className="btn-secondary"
          onClick={() => action(`/api/admin/orders/${id}/restart-workflow`, 'Workflow restarted')}
        >
          Restart workflow
        </button>
        <button className="btn-secondary" onClick={() => action(`/api/admin/orders/${id}/cancel`, 'Order cancelled')}>
          Cancel
        </button>
        <button className="btn-secondary" onClick={() => action(`/api/admin/orders/${id}/refund`, 'Order marked refunded')}>
          Refund
        </button>
      </div>
      <section className="card overflow-hidden">
        <div className="p-4 font-semibold border-b border-(--color-border)">Items</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-(--color-accent-soft) text-left text-xs uppercase">
              <tr>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Delivered</th>
                <th className="px-4 py-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id} className="border-t border-(--color-border)">
                  <td className="px-4 py-2">{it.productName}</td>
                  <td className="px-4 py-2">{it.quantity}</td>
                  <td className="px-4 py-2 font-mono break-all max-w-[220px]">{it.deliveredKey ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{money(it.unitPriceCents * it.quantity, order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="card p-3">
      <div className="text-xs uppercase tracking-wider text-(--color-muted)">{label}</div>
      <div className="mt-1 break-all">{value ?? '—'}</div>
    </div>
  );
}
