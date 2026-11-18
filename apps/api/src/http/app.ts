import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import { healthSchema } from '@gear/shared';
import type { Db } from '../db/client.ts';
import { ensureUser } from '../modules/identity/service.ts';
import { meRoutes } from '../modules/identity/routes.ts';
import { listingRoutes, meListingRoutes, publicListingRoutes } from '../modules/listings/routes.ts';
import type { AuthApi } from '../platform/auth.ts';
import type { Queue } from '../platform/queue.ts';
import type { Storage } from '../platform/storage.ts';
import { requireAuth, type VerifyToken } from './auth.ts';
import { notFound, onError } from './errors.ts';
import { jsonLogger, logRequests, type Logger } from './log.ts';

export type AppDeps = {
  db: Db;
  verifyToken: VerifyToken;
  authApi: AuthApi;
  storage: Storage;
  queue: Queue;
  corsOrigins: string[]; // the web app's origins
  log?: Logger;
};

export function createApp({
  db,
  verifyToken,
  authApi,
  storage,
  queue,
  corsOrigins,
  log = jsonLogger,
}: AppDeps) {
  const app = new Hono<{ Variables: RequestIdVariables }>();
  app.use(requestId());
  app.use(logRequests(log));
  app.use('/v1/*', cors({ origin: corsOrigins }));
  app.onError(onError(log));
  app.notFound(notFound);

  // R1.10, R2.20: open to anyone; 503 when the database or the queue does not answer.
  app.get('/healthz', async (c) => {
    try {
      await db.execute(sql`select 1`);
      if (!(await queue.healthy())) throw new Error('queue unavailable');
      return c.json(healthSchema.parse({ status: 'ok' }), 200);
    } catch {
      return c.json(healthSchema.parse({ status: 'unavailable' }), 503);
    }
  });

  // Open to anyone. Registered first, so these answer before the sign-in check below.
  const open = publicListingRoutes(db, storage, verifyToken);

  const v1 = new Hono()
    .use(requireAuth(verifyToken, (userId) => ensureUser(db, userId)))
    .route('/me', meRoutes(db, authApi, storage, queue))
    .route('/me', meListingRoutes(db, storage))
    .route('/listings', listingRoutes(db, storage, queue));

  return app.route('/v1', open).route('/v1', v1);
}

// For the app's typed client: `import type { AppType } from '@gear/api/app'`.
export type AppType = ReturnType<typeof createApp>;
