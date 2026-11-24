import { Hono } from 'hono';
import { createTripSchema, listQuerySchema, tripListSchema } from '@gear/shared';
import type { Db } from '../../db/client.ts';
import type { AuthVariables } from '../../http/auth.ts';
import { jsonBody, queryParams } from '../../http/errors.ts';
import { createTrip, listTrips } from './service.ts';

// /v1/trips/...: all by the trip's renter (R4.1).
export function tripRoutes(db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .post('/', jsonBody(createTripSchema), async (c) =>
      c.json(await createTrip(db, c.get('userId'), c.req.valid('json')), 201),
    )
    .get('/', queryParams(listQuerySchema), async (c) =>
      c.json(tripListSchema.parse(await listTrips(db, c.get('userId'), c.req.valid('query')))),
    );
}
