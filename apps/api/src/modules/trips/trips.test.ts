import { randomUUID } from 'node:crypto';
import { todayInToronto } from '@gear/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerPool, send, signToken, testApp } from '../../test/helpers.ts';
import { snapToGrid } from '../listings/snap.ts';

const owner = ownerPool();
const t = await testApp();
let categoryId: string;

beforeAll(async () => {
  const { rows } = await owner.query(`select id from public.categories where slug = 'camping'`);
  categoryId = rows[0].id;
});
afterAll(async () => {
  await t.db.$client.end();
  await owner.end();
});

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await t.app.request(path, send(method, token, body));
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}

async function newUser() {
  const id = randomUUID();
  const token = await signToken(t.key, { sub: id });
  expect((await call('GET', '/v1/me', token)).status).toBe(200); // creates the users row
  return { id, token };
}

// A calendar date n days after today in Toronto.
const day = (n: number) =>
  new Date(Date.parse(todayInToronto()) + n * 86_400_000).toISOString().slice(0, 10);

const ADDRESS = '1234 rue Secrète, Montréal';
const PUBLIC = { lat: 45.5265, lng: -73.5808 };
const EXACT = { lat: 45.527123, lng: -73.581234 };

async function newLocation(userId: string): Promise<string> {
  const { rows } = await owner.query(
    `insert into public.pickup_locations (user_id, address, exact_point, public_point, precision)
     values ($1, $2, extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326),
             extensions.st_setsrid(extensions.st_makepoint($5, $6), 4326), '1km') returning id`,
    [userId, ADDRESS, EXACT.lng, EXACT.lat, PUBLIC.lng, PUBLIC.lat],
  );
  return rows[0].id;
}

type Seed = {
  ownerId?: string;
  locationId?: string;
  price?: number;
  deposit?: number;
  status?: string;
};
// Setup writes the rows directly. Two listings share a location only when given the same one.
async function seed(s: Seed = {}): Promise<string> {
  const ownerId = s.ownerId ?? (await newUser()).id;
  const locationId = s.locationId ?? (await newLocation(ownerId));
  const { rows } = await owner.query(
    `insert into public.listings (owner_id, pickup_location_id, category_id, title,
       daily_price_cents, deposit_cents, public_point, status)
     select $1, id, $3, 'Tent', $4, $5, public_point, $6
     from public.pickup_locations where id = $2 returning id`,
    [ownerId, locationId, categoryId, s.price ?? 2500, s.deposit ?? 10000, s.status ?? 'active'],
  );
  await owner.query(
    `insert into public.listing_images (listing_id, storage_path, position, verified_at)
     values ($1, $2, 1, now())`,
    [rows[0].id, `listings/${rows[0].id}/${randomUUID()}.jpg`],
  );
  return rows[0].id;
}

const setListing = (id: string, set: string) =>
  owner.query(`update public.listings set ${set} where id = $1`, [id]);

// Inclusive dates, as an owner sets them.
const block = (listingId: string, start: string, end: string, kind = 'owner_block') =>
  owner.query(
    `insert into public.availability_blocks (listing_id, period, kind, rental_item_id)
     values ($1, daterange($2::date, $3::date, '[]'), $4, $5)`,
    [listingId, start, end, kind, kind === 'rental' ? randomUUID() : null],
  );

const ORIGIN = { lat: 45.5017, lng: -73.5673 };
const tripBody = (change: object = {}) => ({
  name: 'Gaspésie',
  start_date: day(10),
  end_date: day(12),
  ...change,
});
async function newTrip(token: string, change: object = {}): Promise<string> {
  const res = await call('POST', '/v1/trips', token, tripBody(change));
  expect(res.status).toBe(201);
  return res.body.id;
}

describe('creating and listing trips', () => {
  it('creates a trip with its starting point snapped (G4.2)', async () => {
    const { token } = await newUser();
    const res = await call('POST', '/v1/trips', token, tripBody({ origin: ORIGIN }));
    const snapped = snapToGrid(ORIGIN, '1km');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...tripBody(), status: 'draft', origin_point: snapped });
    const { rows } = await owner.query(
      `select extensions.st_y(origin_point::extensions.geometry) as lat,
              extensions.st_x(origin_point::extensions.geometry) as lng
       from public.trips where id = $1`,
      [res.body.id],
    );
    expect(rows).toEqual([snapped]);
  });

  it('creates a trip without a starting point', async () => {
    const { token } = await newUser();
    const res = await call('POST', '/v1/trips', token, tripBody());
    expect(res.status).toBe(201);
    expect(res.body.origin_point).toBeNull();
  });

  it.each([
    ['an empty name', { name: ' ' }],
    ['a name of 61 characters', { name: 'x'.repeat(61) }],
    ['a start today', { start_date: day(0) }],
    ['an end before the start', { end_date: day(9) }],
    ['31 counted days', { end_date: day(40) }],
  ])('refuses %s (G4.6, G4.11)', async (_, change) => {
    const { token } = await newUser();
    expect((await call('POST', '/v1/trips', token, tripBody(change))).status).toBe(400);
  });

  it('accepts 30 counted days from tomorrow and a name of 60 characters', async () => {
    const { token } = await newUser();
    await newTrip(token, { name: 'x'.repeat(60), start_date: day(1), end_date: day(30) });
  });

  it("lists the caller's trips only, newest first, in pages", async () => {
    const { token } = await newUser();
    const first = await newTrip(token);
    const second = await newTrip(token);
    const page1 = await call('GET', '/v1/trips?limit=1', token);
    expect(page1.body.trips.map((x: { id: string }) => x.id)).toEqual([second]);
    const page2 = await call(
      'GET',
      `/v1/trips?limit=1&cursor=${page1.body.next_cursor}`,
      token,
    );
    expect(page2.body.trips.map((x: { id: string }) => x.id)).toEqual([first]);
    expect(page2.body.next_cursor).toBeNull();
    const other = await newUser();
    expect((await call('GET', '/v1/trips', other.token)).body.trips).toEqual([]);
  });

  it('needs a token', async () => {
    expect((await call('GET', '/v1/trips')).status).toBe(401);
    expect((await call('POST', '/v1/trips', undefined, tripBody())).status).toBe(401);
  });
});

const add = (token: string, tripId: string, listingId: string, dates: object = {}) =>
  call('POST', `/v1/trips/${tripId}/items`, token, { listing_id: listingId, ...dates });
async function added(token: string, tripId: string, listingId: string, dates: object = {}) {
  const res = await add(token, tripId, listingId, dates);
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const remove = (token: string, tripId: string, itemId: string) =>
  call('DELETE', `/v1/trips/${tripId}/items/${itemId}`, token);
const itemCount = async (tripId: string): Promise<number> => {
  const { rows } = await owner.query(
    'select count(*)::int as n from public.trip_items where trip_id = $1',
    [tripId],
  );
  return rows[0].n;
};

describe('adding items', () => {
  it("defaults to the trip's dates (R4.3)", async () => {
    const { token } = await newUser();
    const listing = await seed();
    const res = await add(token, await newTrip(token), listing);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      listing_id: listing,
      start_date: day(10),
      end_date: day(12),
    });
  });

  it("accepts its own dates, outside the trip's", async () => {
    const { token } = await newUser();
    const dates = { start_date: day(2), end_date: day(3) };
    const res = await add(token, await newTrip(token), await seed(), dates);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(dates);
  });

  it('writes no availability block (R4.2)', async () => {
    const { token } = await newUser();
    const listing = await seed();
    await added(token, await newTrip(token), listing);
    const { rows } = await owner.query(
      'select 1 from public.availability_blocks where listing_id = $1',
      [listing],
    );
    expect(rows).toEqual([]);
  });

  it('returns the existing item when added again (R4.4, G4.8)', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const listing = await seed();
    const first = await add(token, trip, listing);
    const again = await add(token, trip, listing, { start_date: day(20), end_date: day(21) });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    await setListing(listing, "status = 'paused'");
    const paused = await add(token, trip, listing);
    expect(paused.status).toBe(200);
    expect(paused.body).toEqual(first.body);
    expect(await itemCount(trip)).toBe(1);
  });

  it('leaves one item when two adds arrive at once', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const listing = await seed();
    const both = await Promise.all([add(token, trip, listing), add(token, trip, listing)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await itemCount(trip)).toBe(1);
  });

  it('accepts a listing whose dates are taken (G4.8)', async () => {
    const { token } = await newUser();
    const listing = await seed();
    await block(listing, day(10), day(12));
    await added(token, await newTrip(token), listing);
  });

  it('refuses your own listing (R4.5)', async () => {
    const { id, token } = await newUser();
    const trip = await newTrip(token);
    const res = await add(token, trip, await seed({ ownerId: id }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('own_listing');
    expect(await itemCount(trip)).toBe(0);
  });

  it.each(['draft', 'paused', 'archived'])('refuses a %s listing (R4.5, G4.9)', async (status) => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const res = await add(token, trip, await seed({ status }));
    expect(res.status).toBe(404);
    expect(await itemCount(trip)).toBe(0);
  });

  it('refuses an unknown listing', async () => {
    const { token } = await newUser();
    expect((await add(token, await newTrip(token), randomUUID())).status).toBe(404);
  });

  it.each([
    ['a start today', { start_date: day(0), end_date: day(2) }],
    ['an end before the start', { start_date: day(3), end_date: day(2) }],
    ['31 counted days', { start_date: day(1), end_date: day(31) }],
    ['one date alone', { start_date: day(1) }],
  ])('refuses %s (G4.6)', async (_, dates) => {
    const { token } = await newUser();
    expect((await add(token, await newTrip(token), await seed(), dates)).status).toBe(400);
  });

  it('refuses the default dates of a trip that has started', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    await owner.query('update public.trips set start_date = $2, end_date = $3 where id = $1', [
      trip,
      day(-2),
      day(3),
    ]);
    expect((await add(token, trip, await seed())).status).toBe(400);
  });

  it('holds 50 items at most', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const ownerId = (await newUser()).id;
    const locationId = await newLocation(ownerId);
    const { rows } = await owner.query<{ id: string }>(
      `insert into public.listings (owner_id, title, status, daily_price_cents,
         pickup_location_id, public_point)
       select $1, 'Pole', 'active', 100, p.id, p.public_point
       from public.pickup_locations p, generate_series(1, 49) where p.id = $2 returning id`,
      [ownerId, locationId],
    );
    await owner.query(
      `insert into public.trip_items
         (trip_id, listing_id, start_date, end_date, daily_price_cents_at_add)
       select $1, unnest($2::uuid[]), $3, $4, 100`,
      [trip, rows.map((r) => r.id), day(10), day(12)],
    );
    await added(token, trip, await seed()); // the 50th
    const res = await add(token, trip, await seed());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('trip_full');
    expect((await add(token, trip, rows[0]!.id)).status).toBe(200);
    expect(await itemCount(trip)).toBe(50);
  });
});

describe('removing items', () => {
  it('removes once and succeeds again (G4.9)', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const item = await added(token, trip, await seed());
    expect((await remove(token, trip, item)).status).toBe(204);
    expect(await itemCount(trip)).toBe(0);
    expect((await remove(token, trip, item)).status).toBe(204);
  });

  it("leaves another trip's item alone", async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const other = await newTrip(token);
    const item = await added(token, other, await seed());
    expect((await remove(token, trip, item)).status).toBe(204);
    expect(await itemCount(other)).toBe(1);
  });
});

describe('ownership (R4.1)', () => {
  it('refuses a second user on add and remove', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const item = await added(token, trip, await seed());
    const other = await newUser();
    expect((await add(other.token, trip, await seed())).status).toBe(403);
    expect((await remove(other.token, trip, item)).status).toBe(403);
    expect(await itemCount(trip)).toBe(1);
  });

  it('answers 404 for an unknown trip', async () => {
    const { token } = await newUser();
    const add404 = await add(token, randomUUID(), await seed());
    expect([add404.status, add404.body.code]).toEqual([404, 'not_found']);
    expect((await remove(token, randomUUID(), randomUUID())).status).toBe(404);
  });
});

const read = async (token: string, tripId: string) => {
  const res = await call('GET', `/v1/trips/${tripId}`, token);
  expect(res.status).toBe(200);
  return res;
};
type Group = { items: { listing_id: string; mark: string }[]; [key: string]: unknown };
const shape = (body: { groups: Group[] }) =>
  body.groups.map((g) => g.items.map((i) => i.listing_id));

describe('reading: groups (R4.6)', () => {
  it('puts one owner, one date range and one pickup location in one group', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const ownerId = (await newUser()).id;
    const locationId = await newLocation(ownerId);
    const a = await seed({ ownerId, locationId });
    const b = await seed({ ownerId, locationId });
    await added(token, trip, a);
    await added(token, trip, b);
    expect(shape((await read(token, trip)).body)).toEqual([[a, b]]);
  });

  it('splits one owner with different dates', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const ownerId = (await newUser()).id;
    const locationId = await newLocation(ownerId);
    const a = await seed({ ownerId, locationId });
    const b = await seed({ ownerId, locationId });
    await added(token, trip, a);
    await added(token, trip, b, { start_date: day(10), end_date: day(11) });
    const groups = (await read(token, trip)).body.groups;
    expect(groups.map((g: Group) => [g.start_date, g.end_date, g.days])).toEqual([
      [day(10), day(12), 3],
      [day(10), day(11), 2],
    ]);
  });

  it('splits one owner with different pickup locations', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const ownerId = (await newUser()).id;
    const a = await seed({ ownerId });
    const b = await seed({ ownerId });
    await added(token, trip, a);
    await added(token, trip, b);
    expect(shape((await read(token, trip)).body)).toEqual([[a], [b]]);
  });

  it('splits two owners, and shows each name and rating (R4.9)', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const sam = await newUser();
    await owner.query(
      `update public.users set display_name = 'Sam', owner_rating_avg = 4.75,
         owner_rating_count = 12 where id = $1`,
      [sam.id],
    );
    const other = await newUser();
    await added(token, trip, await seed({ ownerId: sam.id }));
    await added(token, trip, await seed({ ownerId: other.id }));
    const groups = (await read(token, trip)).body.groups;
    expect(groups.map((g: Group) => g.owner)).toEqual([
      { id: sam.id, display_name: 'Sam', rating_avg: 4.75, rating_count: 12 },
      { id: other.id, display_name: null, rating_avg: null, rating_count: 0 },
    ]);
  });

  it('answers with no group and zero totals for an empty trip', async () => {
    const { token } = await newUser();
    const { body } = await read(token, await newTrip(token));
    expect(body).toMatchObject({ groups: [], price_cents: 0, deposit_cents: 0, currency: 'CAD' });
  });
});

describe('reading: marks (R4.7, R4.8, G4.10)', () => {
  const cases: [string, string, (listing: string, item: string) => Promise<unknown>][] = [
    ['nothing changed', 'available', async () => {}],
    ['a block ends the day before', 'available', (l) => block(l, day(7), day(9))],
    ['a block starts the day after', 'available', (l) => block(l, day(13), day(14))],
    ['a blackout takes the last day', 'unavailable', (l) => block(l, day(12), day(14))],
    ['a rental takes the first day', 'unavailable', (l) => block(l, day(8), day(10), 'rental')],
    ['the listing is paused', 'unavailable', (l) => setListing(l, "status = 'paused'")],
    ['the listing is archived', 'unavailable', (l) => setListing(l, "status = 'archived'")],
    [
      'the item starts today',
      'unavailable',
      (_, i) =>
        owner.query('update public.trip_items set start_date = $2 where id = $1', [i, day(0)]),
    ],
    ['the price rose', 'price_changed', (l) => setListing(l, 'daily_price_cents = 3000')],
    ['the price dropped', 'price_changed', (l) => setListing(l, 'daily_price_cents = 2000')],
    [
      'the price changed on taken dates',
      'unavailable',
      async (l) => {
        await setListing(l, 'daily_price_cents = 3000');
        await block(l, day(10), day(12));
      },
    ],
  ];
  it.each(cases)('%s: %s', async (_, mark, change) => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const listing = await seed();
    const item = await added(token, trip, listing);
    await change(listing, item);
    const { body } = await read(token, trip);
    expect(body.groups[0].items[0].mark).toBe(mark);
  });

  it('shows a paused listing that lost its price and pickup location', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token, { origin: ORIGIN });
    const listing = await seed();
    await added(token, trip, listing);
    await setListing(
      listing,
      `status = 'paused', daily_price_cents = null, pickup_location_id = null, public_point = null`,
    );
    const { body } = await read(token, trip);
    expect(body.groups[0]).toMatchObject({ distance_m: null, price_cents: 0, deposit_cents: 0 });
    expect(body.groups[0].items[0]).toMatchObject({
      mark: 'unavailable',
      daily_price_cents: null,
      daily_price_cents_at_add: 2500,
      line_total_cents: null,
    });
  });
});

describe('reading: totals (R4.9, R4.10)', () => {
  it('adds up the group and the trip, without unavailable items', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const ownerId = (await newUser()).id;
    const locationId = await newLocation(ownerId);
    await added(token, trip, await seed({ ownerId, locationId, price: 2500, deposit: 10000 }));
    const cheap = await seed({ ownerId, locationId, price: 1000, deposit: 5000 });
    await added(token, trip, cheap);
    const totals = async () => {
      const { body } = await read(token, trip);
      return [body, ...body.groups].map((x) => [x.price_cents, x.deposit_cents]);
    };
    expect(await totals()).toEqual([
      [10500, 15000],
      [10500, 15000],
    ]);

    const dear = await seed({ price: 4000, deposit: 2000 });
    await added(token, trip, dear, { start_date: day(15), end_date: day(15) });
    expect(await totals()).toEqual([
      [14500, 17000],
      [10500, 15000],
      [4000, 2000],
    ]);

    await block(cheap, day(11), day(11));
    expect(await totals()).toEqual([
      [11500, 12000],
      [7500, 10000],
      [4000, 2000],
    ]);

    await setListing(dear, 'daily_price_cents = 5000');
    expect((await totals())[0]).toEqual([12500, 12000]);
  });
});

describe('reading: location and privacy (R4.11, G4.3)', () => {
  it('measures from the snapped starting point to the public point', async () => {
    const { token } = await newUser();
    const listing = await seed();
    const withOrigin = await newTrip(token, { origin: ORIGIN });
    await added(token, withOrigin, listing);
    const snapped = snapToGrid(ORIGIN, '1km');
    const { rows } = await owner.query(
      `select extensions.st_distance(
         extensions.st_setsrid(extensions.st_makepoint($1, $2), 4326)::extensions.geography,
         extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography) as m`,
      [snapped.lng, snapped.lat, PUBLIC.lng, PUBLIC.lat],
    );
    const { body } = await read(token, withOrigin);
    expect(body.groups[0].distance_m).toBe(Math.round(rows[0].m));

    const without = await newTrip(token);
    await added(token, without, listing);
    expect((await read(token, without)).body.groups[0].distance_m).toBeNull();
  });

  it('returns no address, no exact point and no coordinate but the snapped start', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token, { origin: ORIGIN });
    await added(token, trip, await seed());
    const { text, body } = await read(token, trip);
    expect(text).not.toContain('"address"');
    expect(text).not.toContain('"exact_point"');
    expect(text).not.toContain(ADDRESS);
    expect(text).not.toContain('45.527123');
    expect(body.origin_point).toEqual(snapToGrid(ORIGIN, '1km'));
    expect(text.match(/"(lat|lng)"/g)).toHaveLength(2);
  });
});

describe('reading: ownership (R4.1)', () => {
  it('refuses a second user, and answers 404 for an unknown trip', async () => {
    const { token } = await newUser();
    const trip = await newTrip(token);
    const other = await newUser();
    expect((await call('GET', `/v1/trips/${trip}`, other.token)).status).toBe(403);
    expect((await call('GET', `/v1/trips/${randomUUID()}`, token)).status).toBe(404);
    expect((await call('GET', '/v1/trips/nope', token)).status).toBe(404);
  });
});
