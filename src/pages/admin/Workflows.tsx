import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/format';
import { PlayCircle, RefreshCw } from 'lucide-react';

interface BackupInstance {
  id: string;
  status: string;
  output?: { key?: string; tables?: number };
  error?: { name: string; message: string };
}

/**
 *  Admin operations panel for Cloudflare Workflows.
 *
 *  Surfaces:
 *    • Manual D1 → R2 backup runs (with status polling)
 *    • Quick link to the order workflow status (which lives inline in
 *      the Orders detail page).
 */
export default function AdminWorkflows() {
  const toast = useToast();
  const [backupId, setBackupId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return sessionStorage.getItem('vsp:lastBackupId') ?? '';
  });
  const [backup, setBackup] = useState<BackupInstance | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  useEffect(() => {
    if (!backupId) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const res = await api.get<BackupInstance>(`/api/admin/backups/${encodeURIComponent(backupId)}`);
        if (cancelled) return;
        setBackup(res);
        setLastUpdated(Date.now());
        if (res.status === 'queued' || res.status === 'running' || res.status === 'waiting') {
          timer = window.setTimeout(tick, 5000);
        }
      } catch (err) {
        if (!cancelled) toast.push((err as Error).message, 'error');
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [backupId, toast]);

  const startBackup = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>('/api/admin/backups');
      sessionStorage.setItem('vsp:lastBackupId', r.id);
      setBackupId(r.id);
      toast.push('Backup started', 'success');
    } catch (err) {
      toast.push((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Workflows</h1>

      <section className="card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold">D1 → R2 Backup</h2>
            <p className="text-sm text-(--color-muted) mt-1 max-w-prose">
              Streams every domain table to R2 as newline-delimited JSON, paged in 500-row chunks. Runs
              automatically every day at 04:00 UTC and writes a manifest under{' '}
              <code className="font-mono text-xs">backups/YYYY/MM/DD/visashop-&lt;timestamp&gt;/manifest.json</code>.
            </p>
          </div>
          <button className="btn-primary flex items-center gap-2" onClick={startBackup} disabled={busy}>
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Run backup now
          </button>
        </div>
        {backup && (
          <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
            <Info label="Instance" value={backup.id} />
            <Info label="Status" value={backup.status} />
            {backup.output?.key && <Info label="R2 prefix" value={backup.output.key} />}
            {backup.output?.tables !== undefined && <Info label="Tables" value={String(backup.output.tables)} />}
            {backup.error && <Info label="Error" value={`${backup.error.name}: ${backup.error.message}`} />}
            {lastUpdated > 0 && <Info label="Last update" value={formatDate(lastUpdated)} />}
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Order lifecycle workflows</h2>
        <p className="text-sm text-(--color-muted) mt-1 max-w-prose">
          Each order spawns one workflow instance with the order ID as the instance ID. Inspect or restart
          an individual order's workflow from its{' '}
          <Link className="text-(--color-accent) underline-offset-2 hover:underline" to="/admin/orders">
            order detail page
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs uppercase tracking-wider text-(--color-muted)">{label}</div>
      <div className="mt-1 break-all font-mono text-xs">{value}</div>
    </div>
  );
}
