import { Hono } from 'hono';
import {
  availabilityQuerySchema,
  availabilitySchema,
  searchQuerySchema,
  searchResponseSchema,
} from '@gear/shared';
import type { Db } from '../../db/client.ts';
import { queryParams, uuidParam } from '../../http/errors.ts';
import type { Storage } from '../../platform/storage.ts';
import { getAvailability, searchListings } from './service.ts';

// Open to anyone: mounted before the sign-in check. R3.9: neither answer is cached.
export function searchRoutes(db: Db, storage: Storage) {
  return new Hono()
    .get('/listings', queryParams(searchQuerySchema), async (c) => {
      c.header('Cache-Control', 'no-store');
      const page = await searchListings(db, storage, c.req.valid('query'));
      return c.json(searchResponseSchema.parse(page));
    })
    .get('/listings/:id/availability', queryParams(availabilityQuerySchema), async (c) => {
      c.header('Cache-Control', 'no-store');
      const { from, to } = c.req.valid('query');
      const taken = await getAvailability(db, uuidParam(c.req.param('id')), from, to);
      return c.json(availabilitySchema.parse({ taken }));
    });
}
