/**
 *  Daily D1 → R2 backup workflow.
 *
 *  Triggered by the cron in `wrangler.jsonc` ("0 4 * * *"), this
 *  workflow exports every domain table to a single newline-delimited
 *  JSON file under `backups/YYYY/MM/DD/visashop-<timestamp>.ndjson`.
 *
 *  We export per-table in separate steps so any retry is targeted —
 *  re-trying the workflow does not re-export tables that have already
 *  been written to R2.
 *
 *  Modeled on the official "Backup a D1 database" example.
 *  https://developers.cloudflare.com/workflows/examples/backup-d1/
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { AppEnv } from '../env';

const TABLES = [
  'users',
  'sessions',
  'categories',
  'products',
  'product_files',
  'license_keys',
  'orders',
  'order_items',
  'coupons',
  'reviews',
  'audit_logs',
  'settings',
] as const;

const PAGE_SIZE = 500;

export class D1BackupWorkflow extends WorkflowEntrypoint<AppEnv, Record<string, never>> {
  async run(event: WorkflowEvent<Record<string, never>>, step: WorkflowStep): Promise<{ key: string; tables: number }> {
    const ts = event.timestamp ?? new Date();
    const yyyy = ts.getUTCFullYear();
    const mm = String(ts.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(ts.getUTCDate()).padStart(2, '0');
    const stamp = ts.toISOString().replace(/[:.]/g, '-');
    const baseKey = `backups/${yyyy}/${mm}/${dd}/visashop-${stamp}`;

    let total = 0;
    for (const table of TABLES) {
      // Each table backup is its own step so retries are scoped.
      const written = await step.do(
        `backup-${table}`,
        {
          retries: { limit: 3, delay: '15 seconds', backoff: 'exponential' },
          timeout: '5 minutes',
        },
        async () => {
          let offset = 0;
          let chunkIndex = 0;
          let rows = 0;
          // Stream in pages so a single huge table doesn't blow the
          // step result limit. Each page lands as a separate R2 object.
          for (;;) {
            const page = await this.env.DB
              .prepare(`SELECT * FROM ${table} LIMIT ?1 OFFSET ?2`)
              .bind(PAGE_SIZE, offset)
              .all<Record<string, unknown>>();
            const results = page.results ?? [];
            if (results.length === 0) break;

            const ndjson = results.map((r) => JSON.stringify(r)).join('\n') + '\n';
            const key = `${baseKey}/${table}-${String(chunkIndex).padStart(5, '0')}.ndjson`;
            await this.env.BUCKET.put(key, ndjson, {
              httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' },
              customMetadata: {
                table,
                chunk: String(chunkIndex),
                rows: String(results.length),
                exportedAt: ts.toISOString(),
              },
            });
            rows += results.length;
            chunkIndex += 1;
            if (results.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
          }
          return { table, rows };
        },
      );
      total += written.rows;
    }

    /* Write a manifest so consumers can find the backup quickly. */
    await step.do('write-manifest', { retries: { limit: 3, delay: '5 seconds' } }, async () => {
      const manifest = {
        generatedAt: ts.toISOString(),
        tables: TABLES,
        baseKey,
        totalRows: total,
      };
      await this.env.BUCKET.put(`${baseKey}/manifest.json`, JSON.stringify(manifest, null, 2), {
        httpMetadata: { contentType: 'application/json' },
      });
    });

    return { key: baseKey, tables: TABLES.length };
  }
}
