import { randomUUID } from 'node:crypto';
import { searchResultSchema, todayInToronto } from '@gear/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerPool, send, signToken, testApp } from '../../test/helpers.ts';
import { snapToGrid, type Point } from '../listings/snap.ts';

const owner = ownerPool();
const t = await testApp();
const categories: Record<string, string> = {};

beforeAll(async () => {
  const { rows } = await owner.query<{ id: string; slug: string }>(
    'select id, slug from public.categories',
  );
  for (const row of rows) categories[row.slug] = row.id;
});
afterAll(async () => {
  await t.db.$client.end();
  await owner.end();
});

async function get(path: string, token?: string) {
  const res = await t.app.request(path, send('GET', token));
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

type Query = Record<string, string | number>;
type Row = { id: string; distance_m: number; daily_price_cents: number };
const searchPath = (origin: Point, query: Query = {}) =>
  `/v1/listings?${new URLSearchParams(
    Object.entries({ ...origin, ...query }).map(([k, v]) => [k, String(v)]),
  )}`;

async function search(origin: Point, query: Query = {}) {
  const res = await get(searchPath(origin, query));
  expect(res.status).toBe(200);
  return res.body as { listings: Row[]; next_cursor: string | null };
}
const ids = async (origin: Point, query: Query = {}) =>
  (await search(origin, query)).listings.map((l) => l.id);

async function allPages(origin: Point, query: Query) {
  const seen: Row[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const res: Awaited<ReturnType<typeof search>> = await search(origin, {
      ...query,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...res.listings);
    cursor = res.next_cursor;
    if (!cursor) return seen;
  }
  throw new Error('paging does not end');
}

// The database keeps rows between runs, so each test searches around its own random origin.
const newOrigin = (): Point => ({
  lat: Math.round((Math.random() * 100 - 50) * 1e6) / 1e6,
  lng: Math.round((Math.random() * 300 - 150) * 1e6) / 1e6,
});

async function newUser() {
  const id = randomUUID();
  const token = await signToken(t.key, { sub: id });
  expect((await get('/v1/me', token)).status).toBe(200); // creates the users row
  return { id, token };
}

const ADDRESS = '1234 rue Secrète, Montréal';
type Seed = {
  ownerId?: string;
  exact?: Point;
  title?: string;
  description?: string;
  price?: number;
  category?: string;
  status?: string;
};
// Setup writes the rows directly, so that a test controls the public point exactly.
async function seed(publicPoint: Point, s: Seed = {}): Promise<string> {
  const ownerId = s.ownerId ?? (await newUser()).id;
  const exact = s.exact ?? { lat: publicPoint.lat + 0.001, lng: publicPoint.lng + 0.001 };
  const loc = await owner.query(
    `insert into public.pickup_locations (user_id, address, exact_point, public_point, precision)
     values ($1, $2, extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326),
             extensions.st_setsrid(extensions.st_makepoint($5, $6), 4326), '1km') returning id`,
    [ownerId, ADDRESS, exact.lng, exact.lat, publicPoint.lng, publicPoint.lat],
  );
  const listing = await owner.query(
    `insert into public.listings (owner_id, pickup_location_id, category_id, title, description,
       daily_price_cents, deposit_cents, public_point, status)
     select $1, id, $3, $4, $5, $6, 10000, public_point, $7
     from public.pickup_locations where id = $2 returning id`,
    [
      ownerId,
      loc.rows[0].id,
      categories[s.category ?? 'camping'],
      s.title ?? 'Tent',
      s.description ?? '',
      s.price ?? 2500,
      s.status ?? 'active',
    ],
  );
  const id = listing.rows[0].id as string;
  await addPhoto(id, 1);
  return id;
}

async function addPhoto(listingId: string, position: number, verified = true) {
  const path = `listings/${listingId}/${randomUUID()}.jpg`;
  await owner.query(
    `insert into public.listing_images (listing_id, storage_path, position, verified_at)
     values ($1, $2, $3, $4)`,
    [listingId, path, position, verified ? new Date() : null],
  );
  return path;
}

// Inclusive dates, as an owner sets them.
const block = (listingId: string, start: string, end: string, kind = 'owner_block') =>
  owner.query(
    `insert into public.availability_blocks (listing_id, period, kind, rental_item_id)
     values ($1, daterange($2::date, $3::date, '[]'), $4, $5)`,
    [listingId, start, end, kind, kind === 'rental' ? randomUUID() : null],
  );

// A calendar date n days after today in Toronto.
const day = (n: number) =>
  new Date(Date.parse(todayInToronto()) + n * 86_400_000).toISOString().slice(0, 10);

// The PostGIS distance, as the test's own reference.
async function metres(a: Point, b: Point): Promise<number> {
  const { rows } = await owner.query(
    `select extensions.st_distance(
       extensions.st_setsrid(extensions.st_makepoint($1, $2), 4326)::extensions.geography,
       extensions.st_setsrid(extensions.st_makepoint($3, $4), 4326)::extensions.geography) as m`,
    [a.lng, a.lat, b.lng, b.lat],
  );
  return rows[0].m;
}
const north = (p: Point, degrees: number): Point => ({ lat: p.lat + degrees, lng: p.lng });

describe('radius and distance (R3.2, R3.4)', () => {
  it('measures the radius from the public point, not the exact one', async () => {
    const origin = newOrigin();
    const inside = north(origin, 0.0895); // under 10 km
    const outside = north(origin, 0.0915); // over 10 km
    expect(await metres(origin, inside)).toBeLessThan(10_000);
    expect(await metres(origin, outside)).toBeGreaterThan(10_000);
    const insideId = await seed(inside, { exact: outside });
    await seed(outside, { exact: inside });
    expect(await ids(origin, { radius_km: 10 })).toEqual([insideId]);
  });

  it('returns the distance to the public point, above zero from the exact point', async () => {
    const exact = newOrigin();
    const publicPoint = snapToGrid({ lat: exact.lat + 0.02, lng: exact.lng }, '1km');
    const id = await seed(publicPoint, { exact });
    const { listings } = await search(exact);
    expect(listings.map((l) => l.id)).toEqual([id]);
    expect(listings[0]?.distance_m).toBeGreaterThan(0);
    expect(listings[0]?.distance_m).toBe(Math.round(await metres(exact, publicPoint)));
  });

  it('two listings at one address share coordinates on detail and distance in search', async () => {
    const origin = newOrigin();
    const point = north(origin, 0.01);
    const a = await seed(point);
    const b = await seed(point);
    const { listings } = await search(origin);
    expect(listings).toHaveLength(2);
    expect(listings[0]?.distance_m).toBe(listings[1]?.distance_m);
    const detailA = await get(`/v1/listings/${a}`);
    const detailB = await get(`/v1/listings/${b}`);
    expect(detailA.body.public_point).toEqual(detailB.body.public_point);
  });

  it('defaults to 25 km and lowers a larger radius to 100 km', async () => {
    const origin = newOrigin();
    const near = await seed(north(origin, 0.2)); // about 22 km
    const mid = await seed(north(origin, 0.8)); // about 89 km
    await seed(north(origin, 1)); // about 111 km
    expect(await ids(origin)).toEqual([near]);
    expect(await ids(origin, { radius_km: 500 })).toEqual([near, mid]);
  });

  it.each([
    ['zero radius', { radius_km: 0 }],
    ['negative radius', { radius_km: -1 }],
    ['empty lat', { lat: '' }],
    ['lat out of range', { lat: 91 }],
    ['limit over 30', { limit: 31 }],
    ['unknown sort', { sort: 'newest' }],
    ['a category that is not an id', { category: 'camping' }],
    ['a broken cursor', { cursor: 'nope' }],
    ['a NUL byte in q', { q: 'kay\0' }],
  ] as [string, Query][])('returns 400 for %s', async (_name, query) => {
    const res = await get(searchPath(newOrigin(), query));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('returns 400 without lat and lng', async () => {
    expect((await get('/v1/listings')).status).toBe(400);
  });
});

describe('dates (R3.3, G3.4)', () => {
  it('excludes a listing whose block overlaps the dates, both ends included', async () => {
    const origin = newOrigin();
    const free = await seed(north(origin, 0.001));
    const endsDayBefore = await seed(north(origin, 0.002));
    const startsDayAfter = await seed(north(origin, 0.003));
    const overlaps = await seed(north(origin, 0.004));
    const endsOnFrom = await seed(north(origin, 0.005));
    const startsOnTo = await seed(north(origin, 0.006));
    await block(endsDayBefore, day(5), day(9));
    await block(startsDayAfter, day(13), day(14));
    await block(overlaps, day(11), day(11));
    await block(endsOnFrom, day(8), day(10), 'rental');
    await block(startsOnTo, day(12), day(14));

    expect(await ids(origin, { from: day(10), to: day(12) })).toEqual([
      free,
      endsDayBefore,
      startsDayAfter,
    ]);
    // No dates: the availability filter is skipped.
    expect(await ids(origin)).toHaveLength(6);
  });

  it.each([
    ['from without to', { from: day(2) }, 400],
    ['to without from', { to: day(2) }, 400],
    ['to before from', { from: day(5), to: day(4) }, 400],
    ['from today', { from: day(0), to: day(2) }, 400],
    ['from tomorrow', { from: day(1), to: day(2) }, 200],
    ['30 counted days', { from: day(1), to: day(30) }, 200],
    ['31 counted days', { from: day(1), to: day(31) }, 400],
    ['a date that does not exist', { from: '2099-02-30', to: '2099-03-01' }, 400],
  ] as [string, Query, number][])('%s', async (_name, query, status) => {
    expect((await get(searchPath(newOrigin(), query))).status).toBe(status);
  });

  it('takes today from the Toronto calendar', () => {
    expect(todayInToronto(new Date('2026-07-02T03:30:00Z'))).toBe('2026-07-01');
    expect(todayInToronto(new Date('2026-07-02T04:30:00Z'))).toBe('2026-07-02');
  });
});

describe('order and paging (R3.7)', () => {
  it('orders nearest first', async () => {
    const origin = newOrigin();
    const far = await seed(north(origin, 0.05));
    const near = await seed(north(origin, 0.01));
    const mid = await seed(north(origin, 0.03));
    expect(await ids(origin)).toEqual([near, mid, far]);
    expect(await ids(origin, { sort: 'distance' })).toEqual([near, mid, far]);
  });

  it('pages by distance without a duplicate or a gap, shared distances included', async () => {
    const origin = newOrigin();
    const ownerId = (await newUser()).id;
    const expected: string[] = [];
    for (const step of [0.011, 0.023, 0.023, 0.023, 0.023, 0.037, 0.041]) {
      expected.push(await seed(north(origin, step), { ownerId }));
    }
    const seen = await allPages(origin, { limit: 2 });
    expect(seen.map((l) => l.id).sort()).toEqual([...expected].sort());
    const distances = seen.map((l) => l.distance_m);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('sorts by price, cheapest first, and keeps the radius filter', async () => {
    const origin = newOrigin();
    const dear = await seed(north(origin, 0.01), { price: 9000 });
    const cheap = await seed(north(origin, 0.05), { price: 1000 });
    await seed(north(origin, 0.5), { price: 100 }); // about 55 km
    expect(await ids(origin, { sort: 'price' })).toEqual([cheap, dear]);
  });

  it('pages by price without a duplicate or a gap, shared prices included', async () => {
    const origin = newOrigin();
    const ownerId = (await newUser()).id;
    const expected: string[] = [];
    for (const price of [500, 1500, 1500, 1500, 1500, 2000, 3000]) {
      expected.push(await seed(north(origin, 0.01), { ownerId, price }));
    }
    const seen = await allPages(origin, { sort: 'price', limit: 2 });
    expect(seen.map((l) => l.id).sort()).toEqual([...expected].sort());
    const prices = seen.map((l) => l.daily_price_cents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('refuses a cursor made by the other sort (G3.11)', async () => {
    const origin = newOrigin();
    await seed(north(origin, 0.01));
    await seed(north(origin, 0.02));
    const { next_cursor } = await search(origin, { limit: 1 });
    expect(next_cursor).toEqual(expect.any(String));
    const res = await get(searchPath(origin, { sort: 'price', cursor: next_cursor ?? '' }));
    expect(res.status).toBe(400);
  });

  it('returns 30 to a page by default', async () => {
    const origin = newOrigin();
    const ownerId = (await newUser()).id;
    for (let i = 0; i < 31; i++) await seed(north(origin, 0.01), { ownerId });
    const page = await search(origin);
    expect(page.listings).toHaveLength(30);
    expect(page.next_cursor).toEqual(expect.any(String));
  }, 30_000);
});

describe('filters (R3.1, R3.5, R3.6)', () => {
  it('returns only the category asked for', async () => {
    const origin = newOrigin();
    await seed(north(origin, 0.01), { category: 'camping' });
    const ski = await seed(north(origin, 0.02), { category: 'ski' });
    expect(await ids(origin, { category: categories.ski ?? '' })).toEqual([ski]);
  });

  it('never returns a draft, paused or archived listing', async () => {
    const origin = newOrigin();
    for (const status of ['draft', 'paused', 'archived']) {
      await seed(north(origin, 0.01), { status });
    }
    const active = await seed(north(origin, 0.01));
    expect(await ids(origin)).toEqual([active]);
  });

  it('leaves out an active listing without a price, instead of failing the page', async () => {
    const origin = newOrigin();
    const broken = await seed(north(origin, 0.01));
    await owner.query('update public.listings set daily_price_cents = null where id = $1', [
      broken,
    ]);
    const good = await seed(north(origin, 0.02));
    expect(await ids(origin)).toEqual([good]);
  });

  it('matches title and description, accents ignored, from the start of each word', async () => {
    const origin = newOrigin();
    const velo = await seed(north(origin, 0.01), { title: 'Vélo de route' });
    const kayak = await seed(north(origin, 0.02), {
      title: 'Kayaks',
      description: 'Two boats, one paddle. Velo rack included',
    });
    expect(await ids(origin, { q: 'velo' })).toEqual([velo, kayak]);
    expect(await ids(origin, { q: 'VÉLO' })).toEqual([velo, kayak]);
    expect(await ids(origin, { q: 'kay' })).toEqual([kayak]);
    expect(await ids(origin, { q: 'ayak' })).toEqual([]);
    expect(await ids(origin, { q: 'velo rout' })).toEqual([velo]); // every word
    expect(await ids(origin, { q: 'velo tent' })).toEqual([]);
    expect(await ids(origin, { q: '  ' })).toEqual([velo, kayak]);
  });

  it.each(["kay & | ! ( ) : * '", "kay:*", "kay'", '(kay)', '<-> kay', 'kay\\'])(
    'survives punctuation: %s',
    async (q) => {
      const origin = newOrigin();
      const kayak = await seed(north(origin, 0.01), { title: 'Kayak' });
      expect(await ids(origin, { q })).toEqual([kayak]);
    },
  );
});

describe('results (R3.8, G3.10)', () => {
  it('has exactly the fields of the schema, with the first verified photo', async () => {
    const origin = newOrigin();
    const user = await newUser();
    await owner.query("update public.users set display_name = 'Alice' where id = $1", [user.id]);
    const id = await seed(north(origin, 0.01), { ownerId: user.id });
    await addPhoto(id, 0, false); // first, but not verified
    const { listings } = await search(origin);
    const result = searchResultSchema.strict().parse(listings[0]);
    const photo = await owner.query(
      'select storage_path from public.listing_images where listing_id = $1 and position = 1',
      [id],
    );
    expect(result).toMatchObject({
      id,
      title: 'Tent',
      daily_price_cents: 2500,
      deposit_cents: 10000,
      currency: 'CAD',
      category: { id: categories.camping, slug: 'camping', label: 'Camping' },
      owner: { display_name: 'Alice', rating_avg: null, rating_count: 0 },
    });
    expect(result.photo_url).toContain(photo.rows[0].storage_path);
  });
});

describe('privacy (R3.2, invariant 2)', () => {
  it('search and detail carry no address, no exact point and no exact coordinate', async () => {
    const origin = newOrigin();
    const exact = { lat: origin.lat + 0.004321, lng: origin.lng + 0.001234 };
    const id = await seed(origin, { exact });
    const search = await get(searchPath(origin));
    const detail = await get(`/v1/listings/${id}`);
    const availability = await get(
      `/v1/listings/${id}/availability?from=${day(1)}&to=${day(2)}`,
    );
    expect(search.body.listings).toHaveLength(1);
    const { rows } = await owner.query(
      `select extensions.st_y(exact_point::extensions.geometry) as lat,
              extensions.st_x(exact_point::extensions.geometry) as lng
       from public.pickup_locations p join public.listings l on l.pickup_location_id = p.id
       where l.id = $1`,
      [id],
    );
    for (const res of [search, detail, availability]) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/"address"|"exact_point"|rue Secrète/);
      expect(text).not.toContain(String(rows[0].lat));
      expect(text).not.toContain(String(rows[0].lng));
    }
    expect(JSON.stringify(search.body)).not.toMatch(/"public_point"|"lat"|"lng"/);
  });
});

describe('availability (R3.10, G3.6)', () => {
  const path = (id: string, from: string, to: string) =>
    `/v1/listings/${id}/availability?from=${from}&to=${to}`;

  it('merges ranges that touch, keeps others apart, and returns dates only', async () => {
    const id = await seed(newOrigin());
    await block(id, '2027-01-10', '2027-01-12');
    await block(id, '2027-01-13', '2027-01-15', 'rental');
    await block(id, '2027-01-20', '2027-01-20');
    await block(id, '2027-03-01', '2027-03-02'); // outside the window
    const res = await get(path(id, '2027-01-01', '2027-01-31'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      taken: [
        { start: '2027-01-10', end: '2027-01-15' },
        { start: '2027-01-20', end: '2027-01-20' },
      ],
    });
  });

  it('accepts past dates and 366 counted days; refuses 367, a reversed or a missing window', async () => {
    const id = await seed(newOrigin());
    expect((await get(path(id, '2024-01-01', '2024-12-31'))).status).toBe(200); // 366 days
    expect((await get(path(id, '2024-01-01', '2025-01-01'))).status).toBe(400);
    expect((await get(path(id, '2027-01-02', '2027-01-01'))).status).toBe(400);
    expect((await get(`/v1/listings/${id}/availability`)).status).toBe(400);
    expect((await get(path(id, '0000-01-01', '0000-01-02'))).status).toBe(400); // no year 0 in Postgres
  });

  it('returns 404 for a listing that is not active or does not exist, the owner included', async () => {
    const user = await newUser();
    const id = await seed(newOrigin(), { status: 'paused', ownerId: user.id });
    const active = await seed(newOrigin());
    const window = ['2027-01-01', '2027-01-31'] as const;
    expect((await get(path(active, ...window))).status).toBe(200);
    expect((await get(path(id, ...window))).status).toBe(404);
    expect((await get(path(id, ...window), user.token)).status).toBe(404);
    expect((await get(path(randomUUID(), ...window))).status).toBe(404);
  });
});

describe('cache headers (R3.9)', () => {
  const PUBLIC = 'public, max-age=60, stale-while-revalidate=60';
  const vary = (headers: Headers) => headers.get('Vary') ?? '';

  it('detail is public without a token and private with one', async () => {
    const user = await newUser();
    const other = await newUser();
    const id = await seed(newOrigin(), { ownerId: user.id });
    const anon = await get(`/v1/listings/${id}`);
    expect(anon.headers.get('Cache-Control')).toBe(PUBLIC);
    expect(vary(anon.headers)).toContain('Authorization');
    for (const token of [user.token, other.token]) {
      const res = await get(`/v1/listings/${id}`, token);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(vary(res.headers)).toContain('Authorization');
    }
  });

  it('errors are not cached', async () => {
    const draft = await seed(newOrigin(), { status: 'draft' });
    const active = await seed(newOrigin());
    const missing = await get(`/v1/listings/${draft}`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBe('no-store');
    const badToken = await get(`/v1/listings/${active}`, 'not-a-token');
    expect(badToken.status).toBe(401);
    expect(badToken.headers.get('Cache-Control')).toBe('no-store');
  });

  it('categories last an hour; search and availability are never cached', async () => {
    const origin = newOrigin();
    const id = await seed(origin);
    expect((await get('/v1/categories')).headers.get('Cache-Control')).toBe(
      'public, max-age=3600',
    );
    const searched = await get(searchPath(origin));
    expect(searched.status).toBe(200);
    expect(searched.headers.get('Cache-Control')).toBe('no-store');
    const taken = await get(`/v1/listings/${id}/availability?from=${day(1)}&to=${day(2)}`);
    expect(taken.status).toBe(200);
    expect(taken.headers.get('Cache-Control')).toBe('no-store');
  });
});
