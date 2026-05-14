import type { Config } from 'drizzle-kit';

/**
 *  Drizzle Kit config — used for `drizzle-kit generate` to produce
 *  SQL migrations from `worker/db/schema.ts`.
 *
 *  We use the SQLite dialect (D1 is SQLite-compatible). Migrations are
 *  applied with `wrangler d1 migrations apply` (see package.json
 *  scripts), so drizzle-kit doesn't need direct DB credentials here.
 */
export default {
  schema: './worker/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
} satisfies Config;
