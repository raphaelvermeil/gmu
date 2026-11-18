// Applies the SQL migrations as the table owner (`postgres`).
// R1.14: a deploy runs this before the new API version starts; a failure exits non-zero.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { installQueue } from '../platform/queue.ts';

export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

export async function runMigrations(ownerUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
  // R2.20: the job queue's own schema, installed and upgraded by pg-boss as the owner.
  await installQueue(ownerUrl);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is not set');
  await runMigrations(url);
  console.log(JSON.stringify({ level: 'info', msg: 'migrations applied' }));
}
