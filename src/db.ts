import { readFile } from 'node:fs/promises';
import pg from 'pg';

export interface Result<T = Record<string, any>> { rows: T[]; rowCount: number; }
export interface Db {
  query<T = Record<string, any>>(sql: string, params?: any[]): Promise<Result<T>>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgresDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000,
    statement_timeout: 15000, application_name: 'life-coach' });
  const wrap = (client: pg.Pool | pg.PoolClient): Db => ({
    async query(sql, params = []) {
      const r = await client.query(sql, params);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async transaction(fn) {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const result = await fn(wrap(c)); await c.query('COMMIT'); return result; }
      catch (e) { await c.query('ROLLBACK'); throw e; }
      finally { c.release(); }
    },
    async close() { if (client === pool) await pool.end(); }
  });
  return wrap(pool);
}
export async function migrate(db: Db): Promise<void> {
  const sql = await readFile(new URL('../db/001_foundation.sql', import.meta.url), 'utf8');
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(733714)');
    await tx.query(sql);
    const applied=await tx.query('SELECT version FROM lc_migrations WHERE version=2');
    if(!applied.rowCount){
      const learning=await readFile(new URL('../db/002_execution_learning.sql',import.meta.url),'utf8');
      await tx.query(learning);
    }
  });
}

