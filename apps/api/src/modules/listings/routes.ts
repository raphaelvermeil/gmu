import { Hono, type Context } from 'hono';
import {
  blockListSchema,
  categoryListSchema,
  createListingSchema,
  createPickupLocationSchema,
  listingListSchema,
  listQuerySchema,
  photoUploadSchema,
  pickupLocationListSchema,
  putBlocksSchema,
  queuedSchema,
  updateListingSchema,
  updatePickupLocationSchema,
} from '@gear/shared';
import type { Db } from '../../db/client.ts';
import { optionalCaller, type AuthVariables, type VerifyToken } from '../../http/auth.ts';
import { jsonBody, queryParams, uuidParam } from '../../http/errors.ts';
import type { Queue } from '../../platform/queue.ts';
import type { Storage } from '../../platform/storage.ts';
import {
  changeListingStatus,
  completeListingImageUpload,
  createListing,
  createPickupLocation,
  deleteListingImage,
  getOwnerBlocks,
  getListing,
  issueListingImageUpload,
  listCategories,
  listMyListings,
  listPickupLocations,
  replaceOwnerBlocks,
  updateListing,
  updatePickupLocation,
  type ListingCommand,
} from './service.ts';

// Open to anyone: mounted before the sign-in check.
export function publicListingRoutes(db: Db, storage: Storage, verifyToken: VerifyToken) {
  return new Hono()
    .get('/categories', async (c) =>
      c.json(categoryListSchema.parse({ categories: await listCategories(db) })),
    )
    .get('/listings/:id', async (c) => {
      const viewer = await optionalCaller(verifyToken, c.req.header('Authorization'));
      return c.json(await getListing(db, storage, viewer, uuidParam(c.req.param('id'))));
    });
}

// /v1/me/...: the caller's own pickup locations and listings.
export function meListingRoutes(db: Db, storage: Storage) {
  return new Hono<{ Variables: AuthVariables }>()
    .get('/listings', queryParams(listQuerySchema), async (c) => {
      const page = await listMyListings(db, storage, c.get('userId'), c.req.valid('query'));
      return c.json(listingListSchema.parse(page));
    })
    .get('/pickup-locations', queryParams(listQuerySchema), async (c) => {
      const page = await listPickupLocations(db, c.get('userId'), c.req.valid('query'));
      return c.json(pickupLocationListSchema.parse(page));
    })
    .post('/pickup-locations', jsonBody(createPickupLocationSchema), async (c) => {
      return c.json(await createPickupLocation(db, c.get('userId'), c.req.valid('json')), 201);
    })
    .patch('/pickup-locations/:id', jsonBody(updatePickupLocationSchema), async (c) => {
      const id = uuidParam(c.req.param('id'));
      const location = await db.transaction((tx) =>
        updatePickupLocation(tx, c.get('userId'), id, c.req.valid('json')),
      );
      return c.json(location);
    });
}

// /v1/listings/...: writes, all by the owner (R2.9).
export function listingRoutes(db: Db, storage: Storage, queue: Queue) {
  const command = (name: ListingCommand) => async (c: Context<{ Variables: AuthVariables }>) => {
    const id = uuidParam(c.req.param('id') ?? '');
    const listing = await db.transaction((tx) =>
      changeListingStatus(tx, storage, c.get('userId'), id, name),
    );
    return c.json(listing);
  };

  return new Hono<{ Variables: AuthVariables }>()
    .post('/', jsonBody(createListingSchema), async (c) => {
      const input = c.req.valid('json');
      const listing = await db.transaction((tx) =>
        createListing(tx, storage, c.get('userId'), input),
      );
      return c.json(listing, 201);
    })
    .patch('/:id', jsonBody(updateListingSchema), async (c) => {
      const id = uuidParam(c.req.param('id'));
      const input = c.req.valid('json');
      const listing = await db.transaction((tx) =>
        updateListing(tx, storage, c.get('userId'), id, input),
      );
      return c.json(listing);
    })
    .post('/:id/publish', command('publish'))
    .post('/:id/pause', command('pause'))
    .post('/:id/archive', command('archive'))
    .post('/:id/images', async (c) => {
      const id = uuidParam(c.req.param('id'));
      const upload = await db.transaction((tx) =>
        issueListingImageUpload(tx, storage, c.get('userId'), id),
      );
      return c.json(photoUploadSchema.parse(upload), 201);
    })
    .post('/:id/images/:imageId/complete', async (c) => {
      const id = uuidParam(c.req.param('id'));
      const imageId = uuidParam(c.req.param('imageId'));
      await db.transaction((tx) =>
        completeListingImageUpload(tx, queue, c.get('userId'), id, imageId),
      );
      return c.json(queuedSchema.parse({ status: 'queued' }));
    })
    .delete('/:id/images/:imageId', async (c) => {
      const id = uuidParam(c.req.param('id'));
      const imageId = uuidParam(c.req.param('imageId'));
      await db.transaction((tx) => deleteListingImage(tx, storage, c.get('userId'), id, imageId));
      return c.body(null, 204);
    })
    .get('/:id/blocks', async (c) => {
      const id = uuidParam(c.req.param('id'));
      const saved = await db.transaction((tx) => getOwnerBlocks(tx, c.get('userId'), id));
      return c.json(blockListSchema.parse({ blocks: saved }));
    })
    .put('/:id/blocks', jsonBody(putBlocksSchema), async (c) => {
      const id = uuidParam(c.req.param('id'));
      const { blocks } = c.req.valid('json');
      const saved = await db.transaction((tx) =>
        replaceOwnerBlocks(tx, c.get('userId'), id, blocks),
      );
      return c.json(blockListSchema.parse({ blocks: saved }));
    });
}
