import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export type LedgerDb = NodePgDatabase;
export type LedgerTx = Parameters<Parameters<LedgerDb['transaction']>[0]>[0];

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export function createDb(connectionString: string, options: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return { db: drizzle(pool), close: () => pool.end() };
}

export function migrate(db: LedgerDb) {
  return runMigrations(db, { migrationsFolder });
}
