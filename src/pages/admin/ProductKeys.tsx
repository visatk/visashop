import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/format';

interface KeyRow { id: string; keyValue: string; status: string; createdAt: string | number | Date }
interface FileRow { id: string; label: string; r2Key: string; sizeBytes: number | null; mimeType: string | null }

export default function ProductKeys() {
  const { id = '' } = useParams();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [bulk, setBulk] = useState('');
  const toast = useToast();

  const load = async () => {
    const [k, f] = await Promise.all([
      api.get<KeyRow[]>(`/api/admin/products/${id}/keys`),
      api.get<FileRow[]>(`/api/admin/products/${id}/files`),
    ]);
    setKeys(k);
    setFiles(f);
  };
  useEffect(() => { void load(); }, [id]);

  const addKeys = async () => {
    const list = bulk.split('\n').map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    try {
      const r = await api.post<{ added: number }>(`/api/admin/products/${id}/keys`, { keys: list });
      toast.push(`Added ${r.added} keys`, 'success');
      setBulk('');
      await load();
    } catch (err) {
      toast.push((err as Error).message, 'error');
    }
  };

  const uploadFile = async (file: File, label: string) => {
    const presign = await api.post<{ uploadUrl: string; r2Key: string }>(
      `/api/admin/products/${id}/files/presign`,
      { filename: file.name, contentType: file.type, sizeBytes: file.size },
    );
    const up = await fetch(presign.uploadUrl, { method: 'PUT', body: file, headers: file.type ? { 'Content-Type': file.type } : undefined });
    if (!up.ok) throw new Error('R2 upload failed: ' + up.status);
    await api.post(`/api/admin/products/${id}/files`, {
      label,
      r2Key: presign.r2Key,
      sizeBytes: file.size,
      mimeType: file.type || null,
    });
    toast.push('File uploaded', 'success');
    await load();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Inventory</h1>

      <section className="card p-5">
        <h2 className="font-semibold mb-2">License key pool</h2>
        <p className="text-sm text-(--color-muted) mb-3">One key per line. Duplicates are skipped.</p>
        <textarea className="input min-h-32" value={bulk} onChange={(e) => setBulk(e.target.value)} />
        <div className="mt-3 flex justify-between items-center">
          <span className="text-sm text-(--color-muted)">{keys.filter((k) => k.status === 'available').length} available · {keys.length} total</span>
          <button className="btn-primary" onClick={() => void addKeys()} disabled={!bulk.trim()}>Add keys</button>
        </div>

        <div className="mt-4 max-h-64 overflow-auto border border-(--color-border) rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-(--color-accent-soft) text-left text-xs uppercase sticky top-0">
              <tr><th className="px-3 py-2">Key</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Added</th></tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t border-(--color-border)">
                  <td className="px-3 py-1.5 font-mono">{k.keyValue}</td>
                  <td className="px-3 py-1.5">{k.status}</td>
                  <td className="px-3 py-1.5">{formatDate(k.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-2">Downloadable files (R2)</h2>
        <p className="text-sm text-(--color-muted) mb-3">Buyers receive a signed URL with a 1-hour TTL.</p>
        <FileUpload onUpload={uploadFile} />
        <ul className="mt-4 divide-y divide-(--color-border)">
          {files.map((f) => (
            <li key={f.id} className="py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{f.label}</div>
                <div className="text-xs text-(--color-muted) font-mono">{f.r2Key}</div>
              </div>
              <button
                className="text-(--color-danger) text-sm"
                onClick={async () => {
                  if (!confirm('Delete file?')) return;
                  await api.delete(`/api/admin/products/${id}/files/${f.id}`);
                  await load();
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function FileUpload({ onUpload }: { onUpload: (file: File, label: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
      <input className="input" placeholder="Label (e.g. v1.0.0.zip)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input type="file" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button
        className="btn-primary"
        disabled={!file || !label || busy}
        onClick={async () => {
          if (!file) return;
          setBusy(true);
          try {
            await onUpload(file, label);
            setFile(null); setLabel('');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </div>
  );
}
