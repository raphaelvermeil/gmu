import { z } from 'zod';

// Step 2: categories, pickup locations, listings, photos and blackout dates.

export const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Point = z.infer<typeof pointSchema>;

export const precisionSchema = z.enum(['1km', '5km']); // G2.5
export const conditionSchema = z.enum(['like_new', 'good', 'fair']); // G2.4
export const listingStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']); // R2.6

const cursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const listQuerySchema = cursorQuery;

// GET /v1/categories
export const categorySchema = z.object({ id: z.uuid(), slug: z.string(), label: z.string() });
export const categoryListSchema = z.object({ categories: z.array(categorySchema) });

// /v1/me/pickup-locations. The only output schema with `address` and `exact_point` (R2.4).
export const createPickupLocationSchema = z.strictObject({
  address: z.string().trim().min(1).max(200),
  lat: pointSchema.shape.lat,
  lng: pointSchema.shape.lng,
  precision: precisionSchema.default('1km'),
});
export const updatePickupLocationSchema = z
  .strictObject({
    address: z.string().trim().min(1).max(200).optional(),
    lat: pointSchema.shape.lat.optional(),
    lng: pointSchema.shape.lng.optional(),
    precision: precisionSchema.optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng change together',
  });
export type UpdatePickupLocation = z.infer<typeof updatePickupLocationSchema>;

export const pickupLocationSchema = z.object({
  id: z.uuid(),
  address: z.string(),
  exact_point: pointSchema,
  public_point: pointSchema,
  precision: precisionSchema,
  created_at: z.iso.datetime({ offset: true }),
});
export type PickupLocation = z.infer<typeof pickupLocationSchema>;
export const pickupLocationListSchema = z.object({
  pickup_locations: z.array(pickupLocationSchema),
  next_cursor: z.string().nullable(),
});

// POST and PATCH /v1/listings. Status moves are commands, never a field (G2.12).
const listingFields = {
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000),
  condition: conditionSchema.nullable(),
  category_id: z.uuid().nullable(),
  daily_price_cents: z.number().int().positive().nullable(), // R2.11
  deposit_cents: z.number().int().min(0),
  pickup_location_id: z.uuid().nullable(),
};
export const createListingSchema = z.strictObject({
  ...listingFields,
  description: listingFields.description.optional(),
  condition: listingFields.condition.optional(),
  category_id: listingFields.category_id.optional(),
  daily_price_cents: listingFields.daily_price_cents.optional(),
  deposit_cents: listingFields.deposit_cents.optional(),
  pickup_location_id: listingFields.pickup_location_id.optional(),
});
export const updateListingSchema = z.strictObject(listingFields).partial();
export type CreateListing = z.infer<typeof createListingSchema>;
export type UpdateListing = z.infer<typeof updateListingSchema>;

// Public listing output: the public point only, never the address or exact point (R2.4).
export const listingImageSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  position: z.number().int(),
  verified: z.boolean(),
});
export const listingSchema = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  title: z.string(),
  description: z.string(),
  condition: conditionSchema.nullable(),
  category_id: z.uuid().nullable(),
  daily_price_cents: z.number().int().nullable(),
  deposit_cents: z.number().int(),
  currency: z.literal('CAD'),
  pickup_location_id: z.uuid().nullable(),
  public_point: pointSchema.nullable(),
  status: listingStatusSchema,
  images: z.array(listingImageSchema),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Listing = z.infer<typeof listingSchema>;
export const listingListSchema = z.object({
  listings: z.array(listingSchema),
  next_cursor: z.string().nullable(),
});

// POST /v1/listings/:id/images and POST /v1/me/avatar (R2.13).
export const photoUploadSchema = z.object({
  image_id: z.uuid().optional(),
  storage_path: z.string(),
  upload_url: z.url(),
});
export type PhotoUpload = z.infer<typeof photoUploadSchema>;
// `done` when nothing is waiting: the check already ran (a repeated command succeeds).
export const queuedSchema = z.object({ status: z.enum(['queued', 'done']) });

// PUT /v1/listings/:id/blocks. Dates are inclusive (R2.19).
const isoDate = z.iso.date();
export const blockSchema = z
  .strictObject({ start: isoDate, end: isoDate })
  .refine((b) => b.end >= b.start, { message: 'end is before start' }); // G2.16
export const putBlocksSchema = z.strictObject({ blocks: z.array(blockSchema).max(100) });
export const blockListSchema = z.object({
  blocks: z.array(z.object({ start: isoDate, end: isoDate })),
});
export type Block = { start: string; end: string };
