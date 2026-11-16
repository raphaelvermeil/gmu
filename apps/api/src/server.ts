import { serve } from '@hono/node-server';
import { createDb } from './db/client.ts';
import { createApp } from './http/app.ts';
import { createTokenVerifier } from './http/auth.ts';
import { jsonLogger } from './http/log.ts';
import { createAuthApi, jwksFetcher } from './platform/auth.ts';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// DATABASE_URL connects as the `api` role, never as `postgres`.
const db = createDb(env('DATABASE_URL'));
const supabaseUrl = env('SUPABASE_URL');

const app = createApp({
  db,
  verifyToken: createTokenVerifier({
    issuer: `${supabaseUrl}/auth/v1`,
    audience: 'authenticated',
    fetchKeys: jwksFetcher(supabaseUrl),
  }),
  authApi: createAuthApi(supabaseUrl, env('SUPABASE_PUBLISHABLE_KEY')),
  corsOrigins: env('CORS_ORIGINS').split(','),
});

const port = Number(process.env.PORT ?? 8080);
const server = serve({ fetch: app.fetch, port }, () =>
  jsonLogger({ level: 'info', msg: 'api listening', port }),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => void db.$client.end().then(() => process.exit(0)));
  });
}
