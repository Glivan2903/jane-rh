import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// DATE como string 'YYYY-MM-DD' (sem deslocamento de fuso).
pg.types.setTypeParser(1082, (v) => v);
// NUMERIC e BIGINT chegam como string (sem perda de precisão); a camada de rotas converte quando necessário.
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Q = Pick<pg.PoolClient, 'query'>;

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function migrate(dir = path.resolve(process.cwd(), 'migrations')) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    await tx(async (c) => {
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    });
    applied.push(f);
  }
  return applied;
}
