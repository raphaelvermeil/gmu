import { sql } from 'drizzle-orm';
import {
  errorCodes,
  tripDateError,
  tripSchema,
  type AddTripItem,
  type CreateTrip,
  type Trip,
  type TripItem,
} from '@gear/shared';
import type { Tx } from '../../db/client.ts';
import { ApiError } from '../../http/errors.ts';
import type { Storage } from '../../platform/storage.ts';
import {
  after,
  decodeCursor,
  latOf,
  listingFacts,
  lngOf,
  pageOf,
  toGeography,
  type Page,
} from '../listings/service.ts';
import { snapToGrid } from '../listings/snap.ts';

export const MAX_TRIP_ITEMS = 50; // G4.8

type TripRow = {
  id: string;
  renter_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: Trip['status'];
  origin_lat: number | null;
  origin_lng: number | null;
  created_at: Date;
  created_at_cursor: string;
};

const tripColumns = sql`
  id, renter_id, name, start_date::text, end_date::text, status, created_at,
  created_at::text as created_at_cursor,
  ${latOf('origin_point')} as origin_lat, ${lngOf('origin_point')} as origin_lng`;

const toTrip = (row: TripRow): Trip =>
  tripSchema.parse({
    id: row.id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    origin_point:
      row.origin_lat === null || row.origin_lng === null
        ? null
        : { lat: row.origin_lat, lng: row.origin_lng },
    created_at: new Date(row.created_at).toISOString(),
  });

export async function createTrip(tx: Tx, userId: string, input: CreateTrip): Promise<Trip> {
  const origin = input.origin ? toGeography(snapToGrid(input.origin, '1km')) : sql`null`;
  const { rows } = await tx.execute<TripRow>(sql`
    insert into public.trips (renter_id, name, start_date, end_date, origin_point)
    values (${userId}, ${input.name}, ${input.start_date}, ${input.end_date}, ${origin})
    returning ${tripColumns}`);
  return toTrip(rows[0]!);
}

export async function listTrips(tx: Tx, userId: string, page: Page) {
  const cursor = decodeCursor(page.cursor);
  const { rows } = await tx.execute<TripRow>(sql`
    select ${tripColumns} from public.trips
    where renter_id = ${userId} ${after('trips', cursor)}
    order by trips.created_at desc, trips.id desc
    limit ${page.limit + 1}`);
  const { items, next_cursor } = pageOf(rows, page.limit);
  return { trips: items.map(toTrip), next_cursor };
}

// Invariant 6 and R4.1: every trip route starts here. 404 if missing, 403 if not the renter.
async function ownTrip(tx: Tx, userId: string, tripId: string, lock = false): Promise<TripRow> {
  const { rows } = await tx.execute<TripRow>(sql`
    select ${tripColumns} from public.trips where id = ${tripId} ${lock ? sql`for update` : sql``}`);
  const row = rows[0];
  if (!row) throw new ApiError(404, errorCodes.notFound, 'Not found');
  if (row.renter_id !== userId) throw new ApiError(403, errorCodes.forbidden, 'Not your resource');
  return row;
}

const itemColumns = sql`id, listing_id, start_date::text, end_date::text`;

export async function addTripItem(
  tx: Tx,
  storage: Storage,
  userId: string,
  tripId: string,
  input: AddTripItem,
): Promise<{ item: TripItem; created: boolean }> {
  // The lock puts two adds to one trip in order: one item per listing, and the cap holds.
  const trip = await ownTrip(tx, userId, tripId, true);

  // R4.4, G4.8: before any other check, so a repeat returns the first result.
  const existing = await tx.execute<TripItem>(sql`
    select ${itemColumns} from public.trip_items
    where trip_id = ${tripId} and listing_id = ${input.listing_id}`);
  if (existing.rows[0]) return { item: existing.rows[0], created: false };

  // R4.5, G4.9
  const listing = (await listingFacts(tx, storage, [input.listing_id], null)).get(
    input.listing_id,
  );
  if (listing?.owner_id === userId) {
    throw new ApiError(403, errorCodes.ownListing, 'You cannot add your own listing');
  }
  if (!listing || listing.status !== 'active' || listing.daily_price_cents === null) {
    throw new ApiError(404, errorCodes.notFound, 'Not found');
  }

  const start = input.start_date ?? trip.start_date;
  const end = input.end_date ?? trip.end_date;
  const dateError = tripDateError(start, end);
  if (dateError) throw new ApiError(400, errorCodes.validationFailed, dateError);

  const { rows: counted } = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from public.trip_items where trip_id = ${tripId}`);
  if (counted[0]!.n >= MAX_TRIP_ITEMS) {
    throw new ApiError(409, errorCodes.tripFull, `A trip has at most ${MAX_TRIP_ITEMS} items`);
  }

  const { rows } = await tx.execute<TripItem>(sql`
    insert into public.trip_items
      (trip_id, listing_id, start_date, end_date, daily_price_cents_at_add)
    values (${tripId}, ${input.listing_id}, ${start}, ${end}, ${listing.daily_price_cents})
    returning ${itemColumns}`);
  return { item: rows[0]!, created: true };
}

// G4.9: an item that is not in the trip is already removed.
export async function removeTripItem(
  tx: Tx,
  userId: string,
  tripId: string,
  itemId: string,
): Promise<void> {
  await ownTrip(tx, userId, tripId);
  await tx.execute(sql`
    delete from public.trip_items where id = ${itemId} and trip_id = ${tripId}`);
}
