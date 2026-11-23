import { sql } from 'drizzle-orm';
import {
  errorCodes,
  type Block,
  type SearchQuery,
  type SearchResult,
} from '@gear/shared';
import type { Tx } from '../../db/client.ts';
import { ApiError } from '../../http/errors.ts';
import type { Storage } from '../../platform/storage.ts';
import { LISTING_PHOTOS_BUCKET } from '../listings/jobs.ts';

// R3.12: reads other modules' tables and writes nothing.

type Cursor = { value: number; id: string };

// G3.11: the sort is part of the cursor, so one sort's cursor is refused by the other.
function decodeCursor(cursor: string | undefined, sort: SearchQuery['sort']): Cursor | null {
  if (cursor === undefined) return null;
  try {
    const [by, value, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown[];
    if (
      by === sort &&
      typeof value === 'number' &&
      typeof id === 'string' &&
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)
    ) {
      return { value, id };
    }
  } catch {
    // fall through
  }
  throw new ApiError(400, errorCodes.validationFailed, 'The cursor is not valid');
}

// R3.6: every word must match, from its start. A `q` without any word filters nothing.
function keywordFilter(q: string | undefined) {
  const text = q?.normalize('NFC') ?? '';
  if (!/[\p{L}\p{N}]/u.test(text)) return sql``;
  return sql`and l.search_vector @@ (
    select to_tsquery('simple'::regconfig, string_agg(word || ':*', ' & '))
    from regexp_split_to_table(public.search_text(${text}), ' ') as word
    where word <> '')`;
}

type SearchRow = {
  id: string;
  title: string;
  daily_price_cents: number;
  deposit_cents: number;
  currency: 'CAD';
  distance_m: number;
  category_id: string;
  category_slug: string;
  category_label: string;
  display_name: string | null;
  rating_avg: string | null;
  rating_count: number;
  photo_path: string | null;
};

export async function searchListings(tx: Tx, storage: Storage, query: SearchQuery) {
  const cursor = decodeCursor(query.cursor, query.sort);
  const origin = sql`extensions.st_setsrid(
    extensions.st_makepoint(${query.lng}::float8, ${query.lat}::float8), 4326)::extensions.geography`;
  // R3.2: the public point only.
  const distance = sql`extensions.st_distance(l.public_point, ${origin})`;
  const sortValue = query.sort === 'price' ? sql`l.daily_price_cents` : distance;

  const { rows } = await tx.execute<SearchRow>(sql`
    select l.id, l.title, l.daily_price_cents, l.deposit_cents, l.currency,
           ${distance} as distance_m,
           c.id as category_id, c.slug as category_slug, c.label as category_label,
           u.display_name, u.owner_rating_avg as rating_avg, u.owner_rating_count as rating_count,
           (select i.storage_path from public.listing_images i
            where i.listing_id = l.id and i.verified_at is not null
            order by i.position, i.id limit 1) as photo_path
    from public.listings l
    join public.categories c on c.id = l.category_id
    join public.users u on u.id = l.owner_id
    where l.status = 'active'
      and l.daily_price_cents is not null
      and extensions.st_dwithin(l.public_point, ${origin}, ${query.radius_km * 1000}::float8)
      ${query.category ? sql`and l.category_id = ${query.category}::uuid` : sql``}
      ${keywordFilter(query.q)}
      ${
        query.from && query.to
          ? sql`and not exists (
              select 1 from public.availability_blocks b
              where b.listing_id = l.id
                and b.period && daterange(${query.from}::date, ${query.to}::date, '[]'))`
          : sql``
      }
      ${
        cursor
          ? sql`and (${sortValue}, l.id) > (${cursor.value}::float8, ${cursor.id}::uuid)`
          : sql``
      }
    order by ${query.sort === 'price' ? sql`l.daily_price_cents` : sql`distance_m`}, l.id
    limit ${query.limit + 1}`);

  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  const lastValue = query.sort === 'price' ? last?.daily_price_cents : last?.distance_m;
  return {
    listings: items.map(
      (row): SearchResult => ({
        id: row.id,
        title: row.title,
        daily_price_cents: row.daily_price_cents,
        deposit_cents: row.deposit_cents,
        currency: row.currency,
        photo_url: row.photo_path
          ? storage.publicUrl(LISTING_PHOTOS_BUCKET, row.photo_path)
          : null,
        distance_m: Math.round(row.distance_m),
        category: { id: row.category_id, slug: row.category_slug, label: row.category_label },
        owner: {
          display_name: row.display_name,
          rating_avg: row.rating_avg === null ? null : Number(row.rating_avg),
          rating_count: row.rating_count,
        },
      }),
    ),
    next_cursor:
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify([query.sort, lastValue, last.id])).toString('base64url')
        : null,
  };
}

// R3.10: dates only, cut to the window, with ranges that touch merged.
export async function getAvailability(tx: Tx, listingId: string, from: string, to: string) {
  const { rows: found } = await tx.execute(sql`
    select 1 from public.listings where id = ${listingId} and status = 'active'`);
  if (found.length === 0) throw new ApiError(404, errorCodes.notFound, 'Not found');
  const { rows } = await tx.execute<Block>(sql`
    select lower(r)::text as start, (upper(r) - 1)::text as "end"
    from (
      select unnest(range_agg(period * daterange(${from}::date, ${to}::date, '[]'))) as r
      from public.availability_blocks
      where listing_id = ${listingId}
        and period && daterange(${from}::date, ${to}::date, '[]')
    ) taken
    order by lower(r)`);
  return rows;
}
