import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNotNull, max, sql } from 'drizzle-orm';
import {
  errorCodes,
  listingSchema,
  pickupLocationSchema,
  type Block,
  type CreateListing,
  type Listing,
  type PhotoUpload,
  type PickupLocation,
  type UpdateListing,
  type UpdatePickupLocation,
} from '@gear/shared';
import type { Tx } from '../../db/client.ts';
import { availabilityBlocks, categories, listingImages } from '../../db/schema.ts';
import { ApiError } from '../../http/errors.ts';
import { QUEUES, type Queue } from '../../platform/queue.ts';
import type { Storage } from '../../platform/storage.ts';
import { isPhoneVerified } from '../identity/service.ts';
import { LISTING_PHOTOS_BUCKET } from './jobs.ts';
import { snapToGrid, type Point, type Precision } from './snap.ts';

export const MAX_PHOTOS_PER_LISTING = 8; // G2.6

// ---------- Points (raw SQL: PostGIS) ----------

const toGeography = (p: Point) =>
  sql`extensions.st_setsrid(extensions.st_makepoint(${p.lng}, ${p.lat}), 4326)::extensions.geography`;
const latOf = (column: string) => sql.raw(`extensions.st_y(${column}::extensions.geometry)`);
const lngOf = (column: string) => sql.raw(`extensions.st_x(${column}::extensions.geometry)`);

// ---------- Cursors: (created_at, id), newest first ----------

type Page = { cursor?: string; limit: number };

function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [string, string];
    if (typeof at === 'string' && /^[0-9a-f-]{36}$/.test(id)) return { at, id };
  } catch {
    // fall through
  }
  throw new ApiError(400, errorCodes.validationFailed, 'The cursor is not valid');
}

function pageOf<T extends { created_at_cursor: string; id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const next =
    rows.length > limit && last
      ? Buffer.from(JSON.stringify([last.created_at_cursor, last.id])).toString('base64url')
      : null;
  return { items, next_cursor: next };
}

const after = (table: string, cursor: { at: string; id: string } | null) =>
  cursor
    ? sql`and (${sql.raw(table)}.created_at, ${sql.raw(table)}.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
    : sql``;

// ---------- Categories ----------

export async function listCategories(tx: Tx) {
  return tx
    .select({ id: categories.id, slug: categories.slug, label: categories.label })
    .from(categories)
    .orderBy(asc(categories.position));
}

// ---------- Pickup locations: the only output with address and exact point (R2.4) ----------

type LocationRow = {
  id: string;
  user_id: string;
  address: string;
  precision: Precision;
  exact_lat: number;
  exact_lng: number;
  public_lat: number;
  public_lng: number;
  created_at: Date;
  created_at_cursor: string;
};

const locationColumns = sql`
  id, user_id, address, precision, created_at, created_at::text as created_at_cursor,
  ${latOf('exact_point')} as exact_lat, ${lngOf('exact_point')} as exact_lng,
  ${latOf('public_point')} as public_lat, ${lngOf('public_point')} as public_lng`;

function toPickupLocation(row: LocationRow): PickupLocation {
  return pickupLocationSchema.parse({
    id: row.id,
    address: row.address,
    exact_point: { lat: row.exact_lat, lng: row.exact_lng },
    public_point: { lat: row.public_lat, lng: row.public_lng },
    precision: row.precision,
    created_at: new Date(row.created_at).toISOString(),
  });
}

export async function listPickupLocations(tx: Tx, userId: string, page: Page) {
  const cursor = decodeCursor(page.cursor);
  const { rows } = await tx.execute<LocationRow>(sql`
    select ${locationColumns} from public.pickup_locations
    where user_id = ${userId} ${after('pickup_locations', cursor)}
    order by created_at desc, id desc
    limit ${page.limit + 1}`);
  const { items, next_cursor } = pageOf(rows, page.limit);
  return { pickup_locations: items.map(toPickupLocation), next_cursor };
}

export async function createPickupLocation(
  tx: Tx,
  userId: string,
  input: { address: string; lat: number; lng: number; precision: Precision },
): Promise<PickupLocation> {
  const exact = { lat: input.lat, lng: input.lng };
  const { rows } = await tx.execute<LocationRow>(sql`
    insert into public.pickup_locations (user_id, address, exact_point, public_point, precision)
    values (${userId}, ${input.address}, ${toGeography(exact)},
            ${toGeography(snapToGrid(exact, input.precision))}, ${input.precision})
    returning ${locationColumns}`);
  return toPickupLocation(rows[0]!);
}

// R2.3: the listings' copies of the public point change in the same transaction.
// R2.5 (a location used by a rental is never edited in place) arrives with rentals in step 5.
export async function updatePickupLocation(
  tx: Tx,
  userId: string,
  locationId: string,
  change: UpdatePickupLocation,
): Promise<PickupLocation> {
  const { rows } = await tx.execute<LocationRow>(sql`
    select ${locationColumns} from public.pickup_locations where id = ${locationId} for update`);
  const current = rows[0];
  if (!current) throw notFound();
  if (current.user_id !== userId) throw forbidden(); // R2.9-style ownership check

  const exact = {
    lat: change.lat ?? current.exact_lat,
    lng: change.lng ?? current.exact_lng,
  };
  const precision = change.precision ?? current.precision;
  const publicPoint = snapToGrid(exact, precision);
  const updated = await tx.execute<LocationRow>(sql`
    update public.pickup_locations
    set address = ${change.address ?? current.address},
        exact_point = ${toGeography(exact)},
        public_point = ${toGeography(publicPoint)},
        precision = ${precision},
        updated_at = now()
    where id = ${locationId}
    returning ${locationColumns}`);
  await tx.execute(sql`
    update public.listings set public_point = ${toGeography(publicPoint)}, updated_at = now()
    where pickup_location_id = ${locationId}`);
  return toPickupLocation(updated.rows[0]!);
}

// A listing may only use one of its owner's pickup locations; any other id is 403 (G2.16).
// R2.3: the share lock waits for a move of this location in progress, so the copy taken
// below is the point it ends with.
async function ownLocationPoint(tx: Tx, userId: string, locationId: string) {
  const { rows } = await tx.execute<{ user_id: string }>(sql`
    select user_id from public.pickup_locations where id = ${locationId} for share`);
  if (!rows[0] || rows[0].user_id !== userId) throw forbidden();
  return sql`(select public_point from public.pickup_locations where id = ${locationId})`;
}

// ---------- Listings ----------

type ListingRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  condition: Listing['condition'];
  category_id: string | null;
  daily_price_cents: number | null;
  deposit_cents: number;
  currency: 'CAD';
  pickup_location_id: string | null;
  public_lat: number | null;
  public_lng: number | null;
  status: Listing['status'];
  created_at: Date;
  updated_at: Date;
  created_at_cursor: string;
};

// The public point only. No address and no exact point are selected here (R2.4).
const listingColumns = sql`
  id, owner_id, title, description, condition, category_id, daily_price_cents, deposit_cents,
  currency, pickup_location_id, status, created_at, updated_at,
  created_at::text as created_at_cursor,
  ${latOf('public_point')} as public_lat, ${lngOf('public_point')} as public_lng`;

async function listingRow(tx: Tx, listingId: string, lock = false): Promise<ListingRow | null> {
  const { rows } = await tx.execute<ListingRow>(sql`
    select ${listingColumns} from public.listings where id = ${listingId}
    ${lock ? sql`for update` : sql``}`);
  return rows[0] ?? null;
}

// Invariant 6 and R2.9: every listing write starts here. 404 if missing, 403 if not the owner.
async function ownListing(tx: Tx, userId: string, listingId: string): Promise<ListingRow> {
  const row = await listingRow(tx, listingId, true);
  if (!row) throw notFound();
  if (row.owner_id !== userId) throw forbidden();
  return row;
}

async function toListing(tx: Tx, storage: Storage, row: ListingRow, asOwner: boolean) {
  // R2.16: only verified photos for callers other than the owner.
  const images = await tx
    .select()
    .from(listingImages)
    .where(
      asOwner
        ? eq(listingImages.listingId, row.id)
        : and(eq(listingImages.listingId, row.id), isNotNull(listingImages.verifiedAt)),
    )
    .orderBy(asc(listingImages.position));
  return listingSchema.parse({
    id: row.id,
    owner_id: row.owner_id,
    title: row.title,
    description: row.description,
    condition: row.condition,
    category_id: row.category_id,
    daily_price_cents: row.daily_price_cents,
    deposit_cents: row.deposit_cents,
    currency: row.currency,
    pickup_location_id: row.pickup_location_id,
    public_point:
      row.public_lat === null || row.public_lng === null
        ? null
        : { lat: row.public_lat, lng: row.public_lng },
    status: row.status,
    images: images.map((i) => ({
      id: i.id,
      url: storage.publicUrl(LISTING_PHOTOS_BUCKET, i.storagePath),
      position: i.position,
      verified: i.verifiedAt !== null,
    })),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  });
}

// Anyone for an active listing; the owner for any status. Otherwise 404 (G2.16).
export async function getListing(
  tx: Tx,
  storage: Storage,
  viewerId: string | null,
  listingId: string,
): Promise<Listing> {
  const row = await listingRow(tx, listingId);
  const asOwner = row !== null && row.owner_id === viewerId;
  if (!row || (row.status !== 'active' && !asOwner)) throw notFound();
  return toListing(tx, storage, row, asOwner);
}

export async function listMyListings(tx: Tx, storage: Storage, userId: string, page: Page) {
  const cursor = decodeCursor(page.cursor);
  const { rows } = await tx.execute<ListingRow>(sql`
    select ${listingColumns} from public.listings
    where owner_id = ${userId} ${after('listings', cursor)}
    order by created_at desc, id desc
    limit ${page.limit + 1}`);
  const { items, next_cursor } = pageOf(rows, page.limit);
  const result = [];
  for (const row of items) result.push(await toListing(tx, storage, row, true));
  return { listings: result, next_cursor };
}

async function checkCategory(tx: Tx, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const [found] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!found) throw new ApiError(400, errorCodes.validationFailed, 'Unknown category');
}

export async function createListing(
  tx: Tx,
  storage: Storage,
  userId: string,
  input: CreateListing,
): Promise<Listing> {
  await checkCategory(tx, input.category_id);
  const point = input.pickup_location_id
    ? await ownLocationPoint(tx, userId, input.pickup_location_id)
    : sql`null`;
  const { rows } = await tx.execute<ListingRow>(sql`
    insert into public.listings (owner_id, title, description, condition, category_id,
      daily_price_cents, deposit_cents, pickup_location_id, public_point)
    values (${userId}, ${input.title}, ${input.description ?? ''}, ${input.condition ?? null},
      ${input.category_id ?? null}, ${input.daily_price_cents ?? null}, ${input.deposit_cents ?? 0},
      ${input.pickup_location_id ?? null}, ${point})
    returning ${listingColumns}`);
  return toListing(tx, storage, rows[0]!, true);
}

export async function updateListing(
  tx: Tx,
  storage: Storage,
  userId: string,
  listingId: string,
  input: UpdateListing,
): Promise<Listing> {
  const current = await ownListing(tx, userId, listingId);
  await checkCategory(tx, input.category_id);

  // R2.7 holds while a listing is active: to remove one of these, pause it first.
  if (current.status === 'active') {
    const removed = [
      input.category_id === null && 'category',
      input.daily_price_cents === null && 'price',
      input.pickup_location_id === null && 'pickup_location',
    ].filter((f): f is string => f !== false);
    if (removed.length > 0) {
      throw new ApiError(
        409,
        errorCodes.requiredWhilePublished,
        'A published listing needs these. Pause it first to remove them.',
        { missing: removed },
      );
    }
  }

  const sets = [];
  const columns = {
    title: input.title,
    description: input.description,
    condition: input.condition,
    category_id: input.category_id,
    daily_price_cents: input.daily_price_cents,
    deposit_cents: input.deposit_cents,
  };
  for (const [column, value] of Object.entries(columns)) {
    if (value !== undefined) sets.push(sql`${sql.raw(column)} = ${value}`);
  }
  if (input.pickup_location_id !== undefined) {
    // R2.3: the listing's public point follows its pickup location.
    const point = input.pickup_location_id
      ? await ownLocationPoint(tx, userId, input.pickup_location_id)
      : sql`null`;
    sets.push(sql`pickup_location_id = ${input.pickup_location_id}, public_point = ${point}`);
  }
  sets.push(sql`updated_at = now()`);
  const { rows } = await tx.execute<ListingRow>(sql`
    update public.listings set ${sql.join(sets, sql`, `)} where id = ${listingId}
    returning ${listingColumns}`);
  return toListing(tx, storage, rows[0]!, true);
}

// G2.12: the status moves. Archived is final. R2.8 (archiving with an open rental) is step 5.
const MOVES = {
  publish: { from: ['draft', 'paused'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  archive: { from: ['draft', 'active', 'paused'], to: 'archived' },
} as const;
export type ListingCommand = keyof typeof MOVES;

export async function changeListingStatus(
  tx: Tx,
  storage: Storage,
  userId: string,
  listingId: string,
  command: ListingCommand,
): Promise<Listing> {
  const row = await ownListing(tx, userId, listingId);
  const move = MOVES[command];
  if (!(move.from as readonly string[]).includes(row.status)) {
    throw new ApiError(
      409,
      errorCodes.invalidStatusMove,
      `Cannot ${command} a ${row.status} listing`,
    );
  }
  if (move.to === 'active') {
    const missing = await missingForActivation(tx, row);
    if (missing.length > 0) {
      throw new ApiError(409, errorCodes.activationRefused, 'The listing cannot be published yet', {
        missing,
      });
    }
  }
  const { rows } = await tx.execute<ListingRow>(sql`
    update public.listings set status = ${move.to}, updated_at = now() where id = ${listingId}
    returning ${listingColumns}`);
  return toListing(tx, storage, rows[0]!, true);
}

// R2.7, in this order.
async function missingForActivation(tx: Tx, row: ListingRow): Promise<string[]> {
  const missing: string[] = [];
  if (!(await isPhoneVerified(tx, row.owner_id))) missing.push('phone');
  if (!row.category_id) missing.push('category');
  if (!row.daily_price_cents) missing.push('price');
  if (!row.pickup_location_id) missing.push('pickup_location');
  if ((await verifiedPhotoCount(tx, row.id)) === 0) missing.push('verified_photo');
  return missing;
}

async function verifiedPhotoCount(tx: Tx, listingId: string): Promise<number> {
  const [result] = await tx
    .select({ n: count() })
    .from(listingImages)
    .where(and(eq(listingImages.listingId, listingId), isNotNull(listingImages.verifiedAt)));
  return result?.n ?? 0;
}

// ---------- Photos (R2.13 to R2.17) ----------

export async function issueListingImageUpload(
  tx: Tx,
  storage: Storage,
  userId: string,
  listingId: string,
): Promise<PhotoUpload> {
  await ownListing(tx, userId, listingId);
  const [stats] = await tx
    .select({ n: count(), last: max(listingImages.position) })
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId));
  // G2.6: photos still waiting for the check count toward the limit.
  if ((stats?.n ?? 0) >= MAX_PHOTOS_PER_LISTING) {
    throw new ApiError(
      409,
      errorCodes.photoLimit,
      `A listing has at most ${MAX_PHOTOS_PER_LISTING} photos`,
    );
  }
  const imageId = randomUUID();
  const path = `${listingId}/${imageId}.jpg`; // R2.17: a new path for every photo
  await tx.insert(listingImages).values({
    id: imageId,
    listingId,
    storagePath: path,
    position: (stats?.last ?? -1) + 1,
  });
  const { url } = await storage.createSignedUploadUrl(LISTING_PHOTOS_BUCKET, path);
  return { image_id: imageId, storage_path: path, upload_url: url };
}

async function listingImage(tx: Tx, listingId: string, imageId: string) {
  const [image] = await tx
    .select()
    .from(listingImages)
    .where(and(eq(listingImages.id, imageId), eq(listingImages.listingId, listingId)));
  if (!image) throw notFound();
  return image;
}

export async function completeListingImageUpload(
  tx: Tx,
  queue: Queue,
  userId: string,
  listingId: string,
  imageId: string,
): Promise<void> {
  await ownListing(tx, userId, listingId);
  const image = await listingImage(tx, listingId, imageId);
  if (image.verifiedAt) return; // a repeated command returns the first result
  await queue.send(QUEUES.verifyPhoto, { kind: 'listing', image_id: imageId });
}

// G2.13: removing the last verified photo of an active listing is refused.
export async function deleteListingImage(
  tx: Tx,
  storage: Storage,
  userId: string,
  listingId: string,
  imageId: string,
): Promise<void> {
  const listing = await ownListing(tx, userId, listingId);
  const image = await listingImage(tx, listingId, imageId);
  if (
    listing.status === 'active' &&
    image.verifiedAt &&
    (await verifiedPhotoCount(tx, listingId)) === 1
  ) {
    throw new ApiError(
      409,
      errorCodes.lastVerifiedPhoto,
      'An active listing needs a verified photo',
    );
  }
  await tx.delete(listingImages).where(eq(listingImages.id, imageId));
  await storage.remove(LISTING_PHOTOS_BUCKET, image.storagePath);
}

// ---------- Blackout dates (R2.18, R2.19) ----------

export async function replaceOwnerBlocks(
  tx: Tx,
  userId: string,
  listingId: string,
  blocks: Block[],
): Promise<Block[]> {
  await ownListing(tx, userId, listingId);
  await tx
    .delete(availabilityBlocks)
    .where(
      and(eq(availabilityBlocks.listingId, listingId), eq(availabilityBlocks.kind, 'owner_block')),
    );
  for (const block of blocks) {
    try {
      // An inclusive end date is stored as [start, end + 1 day).
      await tx.execute(sql`
        insert into public.availability_blocks (listing_id, period, kind)
        values (${listingId}, daterange(${block.start}::date, ${block.end}::date + 1, '[)'), 'owner_block')`);
    } catch (error) {
      // Invariant 3: the exclusion constraint decides. 23P01 is exclusion_violation.
      if (pgCode(error) === '23P01') {
        throw new ApiError(409, errorCodes.blockConflict, 'Two blocks overlap', {
          listing_ids: [listingId],
        });
      }
      throw error;
    }
  }
  return listOwnerBlocks(tx, listingId);
}

// G2.18: the owner reads back their blackout dates.
export async function getOwnerBlocks(tx: Tx, userId: string, listingId: string): Promise<Block[]> {
  await ownListing(tx, userId, listingId);
  return listOwnerBlocks(tx, listingId);
}

async function listOwnerBlocks(tx: Tx, listingId: string): Promise<Block[]> {
  const { rows } = await tx.execute<Block>(sql`
    select lower(period)::text as start, (upper(period) - 1)::text as end
    from public.availability_blocks
    where listing_id = ${listingId} and kind = 'owner_block'
    order by lower(period)`);
  return rows;
}

// ---------- Errors ----------

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
const notFound = () => new ApiError(404, errorCodes.notFound, 'Not found');
const forbidden = () => new ApiError(403, errorCodes.forbidden, 'Not your resource');
