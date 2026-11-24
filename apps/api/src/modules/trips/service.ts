import { sql } from 'drizzle-orm';
import { tripSchema, type CreateTrip, type Trip } from '@gear/shared';
import type { Tx } from '../../db/client.ts';
import {
  after,
  decodeCursor,
  latOf,
  lngOf,
  pageOf,
  toGeography,
  type Page,
} from '../listings/service.ts';
import { snapToGrid } from '../listings/snap.ts';

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
