import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import { healthSchema } from '@gear/shared';
import type { Db } from '../db/client.ts';
import { ensureUser } from '../modules/identity/service.ts';
import { meRoutes } from '../modules/identity/routes.ts';
import type { AuthApi } from '../platform/auth.ts';
import { requireAuth, type VerifyToken } from './auth.ts';
import { notFound, onError } from './errors.ts';
import { jsonLogger, logRequests, type Logger } from './log.ts';

export type AppDeps = {
  db: Db;
  verifyToken: VerifyToken;
  authApi: AuthApi;
  corsOrigins: string[]; // the web app's origins
  log?: Logger;
};

export function createApp({ db, verifyToken, authApi, corsOrigins, log = jsonLogger }: AppDeps) {
  const app = new Hono<{ Variables: RequestIdVariables }>();
  app.use(requestId());
  app.use(logRequests(log));
  app.use('/v1/*', cors({ origin: corsOrigins }));
  app.onError(onError(log));
  app.notFound(notFound);

  // R1.10: open to anyone; 503 when the database does not answer.
  app.get('/healthz', async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json(healthSchema.parse({ status: 'ok' }), 200);
    } catch {
      return c.json(healthSchema.parse({ status: 'unavailable' }), 503);
    }
  });

  const v1 = new Hono()
    .use(requireAuth(verifyToken, (userId) => ensureUser(db, userId)))
    .route('/me', meRoutes(db, authApi));

  return app.route('/v1', v1);
}

// For the app's typed client: `import type { AppType } from '@gear/api/app'`.
export type AppType = ReturnType<typeof createApp>;
