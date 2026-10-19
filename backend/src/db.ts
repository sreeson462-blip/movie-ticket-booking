import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = Pick<Pool | PoolClient, 'query'>;

/** Run `fn` inside one transaction (BEGIN ... COMMIT, ROLLBACK on any error). */
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken: nothing else to do */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function rows<T extends QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T extends QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}

/** True when `err` is a PostgreSQL error with the given SQLSTATE code. */
export function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

export const PG = {
  UNIQUE_VIOLATION: '23505',
  FK_VIOLATION: '23503',
  EXCLUSION_VIOLATION: '23P01',
  DEADLOCK: '40P01',
  SERIALIZATION: '40001',
};
