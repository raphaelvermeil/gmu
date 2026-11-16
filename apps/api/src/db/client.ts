import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

// R1.13: one pool of about 10 connections for the life of the process.
export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5_000 });
  return drizzle({ client: pool, schema });
}

export type Db = ReturnType<typeof createDb>;
// Service functions take this as their first argument: the pool or an open transaction.
export type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
