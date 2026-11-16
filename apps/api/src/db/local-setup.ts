// Local stack only: migrate, then let the `api` role log in with a throwaway password.
// On staging and production the password is set by hand (see docs/spec/01-foundations.md).
import pg from 'pg';
import { runMigrations } from './migrate.ts';

export const LOCAL_OWNER_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const LOCAL_API_URL = 'postgresql://api:api@127.0.0.1:54322/postgres';

export async function setupLocalDb(ownerUrl = LOCAL_OWNER_URL): Promise<void> {
  const host = new URL(ownerUrl).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`local-setup refuses to run against ${host}`);
  }
  await runMigrations(ownerUrl);
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`alter role api with login password 'api'`);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await setupLocalDb();
  console.log(JSON.stringify({ level: 'info', msg: 'local database ready' }));
}
