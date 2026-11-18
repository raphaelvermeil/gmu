import { execFileSync } from 'node:child_process';
import { setupLocalDb } from '../db/local-setup.ts';

export default async function setup(): Promise<void> {
  await setupLocalDb();
  // The local stack's secret key, read from the running stack so it is never committed.
  // Test workers inherit this environment.
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }));
  process.env.LOCAL_SUPABASE_SECRET_KEY = status.SECRET_KEY;
}
