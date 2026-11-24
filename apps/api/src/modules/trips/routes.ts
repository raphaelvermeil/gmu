import { Hono } from 'hono';
import {
  addTripItemSchema,
  createTripSchema,
  listQuerySchema,
  tripItemSchema,
  tripListSchema,
} from '@gear/shared';
import type { Db } from '../../db/client.ts';
import type { AuthVariables } from '../../http/auth.ts';
import { jsonBody, queryParams, uuidParam } from '../../http/errors.ts';
import type { Storage } from '../../platform/storage.ts';
import { addTripItem, createTrip, getTrip, listTrips, removeTripItem } from './service.ts';

// /v1/trips/...: all by the trip's renter (R4.1).
export function tripRoutes(db: Db, storage: Storage) {
  return new Hono<{ Variables: AuthVariables }>()
    .post('/', jsonBody(createTripSchema), async (c) =>
      c.json(await createTrip(db, c.get('userId'), c.req.valid('json')), 201),
    )
    .get('/', queryParams(listQuerySchema), async (c) =>
      c.json(tripListSchema.parse(await listTrips(db, c.get('userId'), c.req.valid('query')))),
    )
    .get('/:id', async (c) => {
      const id = uuidParam(c.req.param('id'));
      return c.json(await getTrip(db, storage, c.get('userId'), id));
    })
    .post('/:id/items', jsonBody(addTripItemSchema), async (c) => {
      const id = uuidParam(c.req.param('id'));
      const { item, created } = await db.transaction((tx) =>
        addTripItem(tx, storage, c.get('userId'), id, c.req.valid('json')),
      );
      return c.json(tripItemSchema.parse(item), created ? 201 : 200);
    })
    .delete('/:id/items/:itemId', async (c) => {
      const id = uuidParam(c.req.param('id'));
      const itemId = uuidParam(c.req.param('itemId'));
      await db.transaction((tx) => removeTripItem(tx, c.get('userId'), id, itemId));
      return c.body(null, 204);
    });
}
