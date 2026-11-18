import { serve } from '@hono/node-server';
import { createDb } from './db/client.ts';
import { createApp } from './http/app.ts';
import { createTokenVerifier } from './http/auth.ts';
import { jsonLogger } from './http/log.ts';
import { verifyAvatar } from './modules/identity/jobs.ts';
import { verifyListingImage } from './modules/listings/jobs.ts';
import { createAuthApi, jwksFetcher } from './platform/auth.ts';
import { createQueue, QUEUES } from './platform/queue.ts';
import { createStorage } from './platform/storage.ts';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// DATABASE_URL connects as the `api` role, never as `postgres`.
const db = createDb(env('DATABASE_URL'));
const supabaseUrl = env('SUPABASE_URL');
// Server only: signs upload URLs and reads, checks and deletes uploaded photos.
// SUPABASE_PUBLIC_URL is optional: set it only when phones reach Supabase at another address.
const storage = createStorage(
  supabaseUrl,
  env('SUPABASE_SECRET_KEY'),
  process.env.SUPABASE_PUBLIC_URL || supabaseUrl,
);
const queue = createQueue(env('DATABASE_URL'));

const app = createApp({
  db,
  verifyToken: createTokenVerifier({
    issuer: `${supabaseUrl}/auth/v1`,
    audience: 'authenticated',
    fetchKeys: jwksFetcher(supabaseUrl),
  }),
  authApi: createAuthApi(supabaseUrl, env('SUPABASE_PUBLISHABLE_KEY')),
  storage,
  queue,
  corsOrigins: env('CORS_ORIGINS').split(','),
});

// R2.20: the worker runs inside the API process.
await queue.work(QUEUES.verifyPhoto, async (data) => {
  const job = data as { kind: 'listing'; image_id: string } | { kind: 'avatar'; user_id: string; path: string };
  if (job.kind === 'listing') await verifyListingImage(db, storage, job.image_id);
  else if (job.kind === 'avatar') await verifyAvatar(db, storage, job.user_id, job.path);
});

const port = Number(process.env.PORT ?? 8080);
const server = serve({ fetch: app.fetch, port }, () =>
  jsonLogger({ level: 'info', msg: 'api listening', port }),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => void queue.stop().then(() => db.$client.end()).then(() => process.exit(0)));
  });
}
