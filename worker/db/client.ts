import { drizzle } from 'drizzle-orm/d1';
import type { AppEnv } from '../env';
import * as schema from './schema';

export type DB = ReturnType<typeof drizzle<typeof schema>>;

/**
 *  Drizzle D1 adapter. Casing is declared per-column in the schema,
 *  so no global casing option is needed (and avoids future churn if
 *  the option signature changes between drizzle releases).
 */
export function getDb(env: AppEnv): DB {
  return drizzle(env.DB, { schema });
}

export { schema };
