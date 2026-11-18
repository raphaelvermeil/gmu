import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { ownerPool, send, signToken, testApp } from '../../test/helpers.ts';

const owner = ownerPool();
const t = await testApp();
afterAll(async () => {
  await t.db.$client.end();
  await owner.end();
});

type Point = { lat: number; lng: number };
// Not a cell centre, so the public point differs from it.
const HOME: Point = { lat: 45.4961, lng: -73.5739 };
const ADDRESS = '1234 rue Secrète, Montréal';

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await t.app.request(path, send(method, token, body));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function newUser({ phoneVerified = true } = {}) {
  const id = randomUUID();
  const token = await signToken(t.key, { sub: id });
  expect((await call('GET', '/v1/me', token)).status).toBe(200); // creates the users row
  if (phoneVerified) {
    await owner.query('update public.users set phone_verified_at = now() where id = $1', [id]);
  }
  return { id, token };
}

async function createLocation(token: string, point: Point = HOME, precision = '1km') {
  const res = await call('POST', '/v1/me/pickup-locations', token, {
    address: ADDRESS,
    lat: point.lat,
    lng: point.lng,
    precision,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; public_point: Point; exact_point: Point };
}

async function categoryId(slug = 'camping'): Promise<string> {
  const res = await call('GET', '/v1/categories');
  expect(res.status).toBe(200);
  const found = (res.body.categories as { id: string; slug: string }[]).find(
    (c) => c.slug === slug,
  );
  if (!found) throw new Error(`no category ${slug}`);
  return found.id;
}

async function createListing(token: string, fields: Record<string, unknown> = {}) {
  const res = await call('POST', '/v1/listings', token, { title: 'Tent for 4', ...fields });
  expect(res.status).toBe(201);
  return res.body as { id: string; status: string; public_point: Point | null };
}

// Test setup writes the photo row directly; the job that sets verified_at has its own test.
async function addPhoto(listingId: string, verified = true) {
  await owner.query(
    `insert into public.listing_images (listing_id, storage_path, position, verified_at)
     values ($1, $2, 0, $3)`,
    [listingId, `listings/${listingId}/${randomUUID()}.jpg`, verified ? new Date() : null],
  );
}

// A listing that meets every precondition of R2.7, still in draft.
async function readyListing(token: string) {
  const location = await createLocation(token);
  const listing = await createListing(token, {
    description: 'A 4-person tent with footprint',
    condition: 'good',
    category_id: await categoryId(),
    daily_price_cents: 2500,
    deposit_cents: 10000,
    pickup_location_id: location.id,
  });
  await addPhoto(listing.id);
  return { listing, location };
}

// Every key and every number in a JSON value, at any depth.
function walk(value: unknown, keys: string[] = [], numbers: number[] = [], strings: string[] = []) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, keys, numbers, strings));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      keys.push(k);
      walk(v, keys, numbers, strings);
    }
  } else if (typeof value === 'number') numbers.push(value);
  else if (typeof value === 'string') strings.push(value);
  return { keys, numbers, strings };
}

function expectNoExactLocation(body: unknown, exact: Point) {
  const { keys, numbers, strings } = walk(body);
  expect(keys).not.toContain('address');
  expect(keys).not.toContain('exact_point');
  expect(numbers).not.toContain(exact.lat);
  expect(numbers).not.toContain(exact.lng);
  expect(strings.join('\n')).not.toContain('rue Secrète');
}

describe('pickup locations (R2.1, R2.4)', () => {
  it('returns the address and both points to the owner; the public point is snapped', async () => {
    const alice = await newUser();
    const location = await createLocation(alice.token);
    expect(location.exact_point).toEqual(HOME);
    expect(location.public_point).not.toEqual(HOME);

    const list = await call('GET', '/v1/me/pickup-locations', alice.token);
    expect(list.status).toBe(200);
    expect(list.body.pickup_locations).toHaveLength(1);
    expect(list.body.pickup_locations[0].address).toBe(ADDRESS);
  });

  it('lists only the caller’s locations, and another user cannot edit one (403)', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const location = await createLocation(alice.token);

    expect((await call('GET', '/v1/me/pickup-locations', bob.token)).body.pickup_locations).toEqual(
      [],
    );
    const res = await call('PATCH', `/v1/me/pickup-locations/${location.id}`, bob.token, {
      address: 'Elsewhere',
    });
    expect(res.status).toBe(403);
  });
});

describe('privacy (R2.4, invariant 2)', () => {
  it('no route but /v1/me/pickup-locations returns an address or exact point, for any caller', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const { listing, location } = await readyListing(alice.token);
    expect((await call('POST', `/v1/listings/${listing.id}/publish`, alice.token)).status).toBe(
      200,
    );

    const L = `/v1/listings/${listing.id}`;
    let imageId = '';
    // [method, path, body, expected status as the owner, as another user, with no token]
    const routes: [string, () => string, unknown, number, number, number][] = [
      ['GET', () => '/v1/categories', undefined, 200, 200, 200],
      ['GET', () => '/v1/me/listings', undefined, 200, 200, 401],
      ['GET', () => L, undefined, 200, 200, 200],
      ['PATCH', () => L, { title: 'Tent for 4 people' }, 200, 403, 401],
      [
        'POST',
        () => '/v1/listings',
        { title: 'Stove', pickup_location_id: location.id },
        201,
        403,
        401,
      ],
      ['POST', () => `${L}/pause`, undefined, 200, 403, 401],
      ['POST', () => `${L}/publish`, undefined, 200, 403, 401],
      ['POST', () => `${L}/images`, undefined, 201, 403, 401],
      ['POST', () => `${L}/images/${imageId}/complete`, undefined, 200, 403, 401],
      ['DELETE', () => `${L}/images/${imageId}`, undefined, 204, 403, 401],
      [
        'PUT',
        () => `${L}/blocks`,
        { blocks: [{ start: '2027-01-10', end: '2027-01-12' }] },
        200,
        403,
        401,
      ],
      ['GET', () => `${L}/blocks`, undefined, 200, 403, 401],
      ['POST', () => '/v1/me/avatar', undefined, 201, 201, 401],
      ['POST', () => '/v1/me/avatar/complete', undefined, 200, 200, 401],
    ];

    for (const [method, path, body, asOwner, asOther, asAnon] of routes) {
      // The owner goes last, so a route that changes state still answers the others first.
      for (const [token, expected] of [
        [undefined, asAnon],
        [bob.token, asOther],
        [alice.token, asOwner],
      ] as const) {
        const res = await call(method, path(), token, body);
        expect({ route: `${method} ${path()}`, status: res.status }).toEqual({
          route: `${method} ${path()}`,
          status: expected,
        });
        expectNoExactLocation(res.body, HOME);
        if (token === alice.token && path() === `${L}/images`) imageId = res.body.image_id;
      }
    }
  });
});

describe('public point copies (R2.3)', () => {
  it('moving a pickup location updates the public point of every listing on it', async () => {
    const alice = await newUser();
    const location = await createLocation(alice.token);
    const a = await createListing(alice.token, { pickup_location_id: location.id });
    const b = await createListing(alice.token, { pickup_location_id: location.id });
    expect(a.public_point).toEqual(location.public_point);

    const moved = await call('PATCH', `/v1/me/pickup-locations/${location.id}`, alice.token, {
      lat: 45.53,
      lng: -73.62,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.public_point).not.toEqual(location.public_point);

    for (const id of [a.id, b.id]) {
      const res = await call('GET', `/v1/listings/${id}`, alice.token);
      expect(res.body.public_point).toEqual(moved.body.public_point);
    }
  });

  it('a failed transaction leaves the location and every listing copy unchanged', async () => {
    const { updatePickupLocation } = await import('./service.ts');
    const alice = await newUser();
    const location = await createLocation(alice.token);
    const listing = await createListing(alice.token, { pickup_location_id: location.id });

    await expect(
      t.db.transaction(async (tx) => {
        await updatePickupLocation(tx, alice.id, location.id, { lat: 45.53, lng: -73.62 });
        throw new Error('fail after the update');
      }),
    ).rejects.toThrow('fail after the update');

    const loc = await call('GET', '/v1/me/pickup-locations', alice.token);
    expect(loc.body.pickup_locations[0].public_point).toEqual(location.public_point);
    const res = await call('GET', `/v1/listings/${listing.id}`, alice.token);
    expect(res.body.public_point).toEqual(location.public_point);
  });
});

describe('activation (R2.7)', () => {
  it('publishes a listing that meets every precondition', async () => {
    const alice = await newUser();
    const { listing } = await readyListing(alice.token);
    const res = await call('POST', `/v1/listings/${listing.id}/publish`, alice.token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  const missing: [string, (token: string, userId: string, listingId: string) => Promise<void>][] = [
    [
      'phone',
      async (_token, userId) => {
        await owner.query('update public.users set phone_verified_at = null where id = $1', [
          userId,
        ]);
      },
    ],
    ['category', (token, _u, id) => patch(token, id, { category_id: null })],
    ['price', (token, _u, id) => patch(token, id, { daily_price_cents: null })],
    ['pickup_location', (token, _u, id) => patch(token, id, { pickup_location_id: null })],
    [
      'verified_photo',
      async (_t, _u, id) => {
        await owner.query(
          'update public.listing_images set verified_at = null where listing_id = $1',
          [id],
        );
      },
    ],
  ];

  async function patch(token: string, id: string, fields: Record<string, unknown>) {
    expect((await call('PATCH', `/v1/listings/${id}`, token, fields)).status).toBe(200);
  }

  for (const [precondition, remove] of missing) {
    it(`refuses with 409 when ${precondition} is missing`, async () => {
      const alice = await newUser();
      const { listing } = await readyListing(alice.token);
      await remove(alice.token, alice.id, listing.id);

      const res = await call('POST', `/v1/listings/${listing.id}/publish`, alice.token);
      expect(res.status).toBe(409);
      expect(res.body.details.missing).toEqual([precondition]);
      const after = await call('GET', `/v1/listings/${listing.id}`, alice.token);
      expect(after.body.status).toBe('draft');
    });
  }
});

describe('ownership (R2.9)', () => {
  it('another user gets 403 on edit, status, photos and blocks, and nothing changes', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const { listing } = await readyListing(alice.token);
    const L = `/v1/listings/${listing.id}`;
    const { rows } = await owner.query(
      'select id from public.listing_images where listing_id = $1',
      [listing.id],
    );
    const imageId = rows[0].id;

    const attempts: [string, string, unknown?][] = [
      ['PATCH', L, { title: 'Mine now' }],
      ['POST', `${L}/publish`],
      ['POST', `${L}/archive`],
      ['POST', `${L}/images`],
      ['POST', `${L}/images/${imageId}/complete`],
      ['DELETE', `${L}/images/${imageId}`],
      ['PUT', `${L}/blocks`, { blocks: [{ start: '2027-02-01', end: '2027-02-03' }] }],
      ['GET', `${L}/blocks`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(method, path, bob.token, body);
      expect({ route: `${method} ${path}`, status: res.status }).toEqual({
        route: `${method} ${path}`,
        status: 403,
      });
    }

    const after = await call('GET', L, alice.token);
    expect(after.body.title).toBe('Tent for 4');
    expect(after.body.status).toBe('draft');
    const counts = await owner.query(
      `select (select count(*)::int from public.listing_images where listing_id = $1) as images,
              (select count(*)::int from public.availability_blocks where listing_id = $1) as blocks`,
      [listing.id],
    );
    expect(counts.rows[0]).toEqual({ images: 1, blocks: 0 });
  });
});

describe('blackout dates (R2.18, R2.19)', () => {
  async function putBlocks(token: string, id: string, blocks: { start: string; end: string }[]) {
    return call('PUT', `/v1/listings/${id}/blocks`, token, { blocks });
  }

  async function storedPeriods(listingId: string): Promise<string[]> {
    const { rows } = await owner.query(
      `select period::text as period from public.availability_blocks
       where listing_id = $1 and kind = 'owner_block' order by lower(period)`,
      [listingId],
    );
    return rows.map((r) => r.period);
  }

  it('stores an inclusive end date as [start, end + 1 day)', async () => {
    const alice = await newUser();
    const listing = await createListing(alice.token);
    const res = await putBlocks(alice.token, listing.id, [
      { start: '2027-01-01', end: '2027-01-04' },
    ]);
    expect(res.status).toBe(200);
    expect(await storedPeriods(listing.id)).toEqual(['[2027-01-01,2027-01-05)']);
  });

  it('reads back the inclusive dates it was given (G2.18)', async () => {
    const alice = await newUser();
    const listing = await createListing(alice.token);
    const blocks = [
      { start: '2027-01-01', end: '2027-01-04' },
      { start: '2027-02-10', end: '2027-02-10' },
    ];
    expect((await putBlocks(alice.token, listing.id, blocks)).body).toEqual({ blocks });
    const res = await call('GET', `/v1/listings/${listing.id}/blocks`, alice.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ blocks });
  });

  it('accepts two periods that touch: one ends on the 4th, the next starts on the 5th', async () => {
    const alice = await newUser();
    const listing = await createListing(alice.token);
    const res = await putBlocks(alice.token, listing.id, [
      { start: '2027-01-01', end: '2027-01-04' },
      { start: '2027-01-05', end: '2027-01-07' },
    ]);
    expect(res.status).toBe(200);
    expect(await storedPeriods(listing.id)).toEqual([
      '[2027-01-01,2027-01-05)',
      '[2027-01-05,2027-01-08)',
    ]);
  });

  it('refuses overlapping periods with 409 and keeps the previous blocks', async () => {
    const alice = await newUser();
    const listing = await createListing(alice.token);
    await putBlocks(alice.token, listing.id, [{ start: '2027-03-01', end: '2027-03-02' }]);

    const res = await putBlocks(alice.token, listing.id, [
      { start: '2027-01-01', end: '2027-01-04' },
      { start: '2027-01-04', end: '2027-01-06' },
    ]);
    expect(res.status).toBe(409);
    expect(await storedPeriods(listing.id)).toEqual(['[2027-03-01,2027-03-03)']);
  });

  it('replaces the owner blocks', async () => {
    const alice = await newUser();
    const listing = await createListing(alice.token);
    await putBlocks(alice.token, listing.id, [{ start: '2027-03-01', end: '2027-03-02' }]);
    await putBlocks(alice.token, listing.id, [{ start: '2027-04-01', end: '2027-04-01' }]);
    expect(await storedPeriods(listing.id)).toEqual(['[2027-04-01,2027-04-02)']);
  });

  it('refuses a period that ends before it starts with 400 (G2.16)', async () => {
    const alice = await newUser();
    const listing = await createListing(alice.token);
    const res = await putBlocks(alice.token, listing.id, [
      { start: '2027-01-05', end: '2027-01-04' },
    ]);
    expect(res.status).toBe(400);
  });
});

describe('a published listing keeps its preconditions (R2.7)', () => {
  for (const [field, removal] of [
    ['category', { category_id: null }],
    ['price', { daily_price_cents: null }],
    ['pickup_location', { pickup_location_id: null }],
  ] as const) {
    it(`refuses with 409 to remove the ${field} of an active listing, and of a paused one`, async () => {
      const alice = await newUser();
      const { listing } = await readyListing(alice.token);
      await call('POST', `/v1/listings/${listing.id}/publish`, alice.token);

      const active = await call('PATCH', `/v1/listings/${listing.id}`, alice.token, removal);
      expect(active.status).toBe(409);
      expect(active.body.details.missing).toEqual([field]);

      await call('POST', `/v1/listings/${listing.id}/pause`, alice.token);
      const paused = await call('PATCH', `/v1/listings/${listing.id}`, alice.token, removal);
      expect(paused.status).toBe(200);
    });
  }

  it('still accepts other edits of an active listing', async () => {
    const alice = await newUser();
    const { listing } = await readyListing(alice.token);
    await call('POST', `/v1/listings/${listing.id}/publish`, alice.token);
    const res = await call('PATCH', `/v1/listings/${listing.id}`, alice.token, {
      title: 'Tent for 4, with footprint',
      daily_price_cents: 3000,
    });
    expect(res.status).toBe(200);
  });
});

describe('pickup location of a listing (G2.16)', () => {
  it('a location that does not exist returns 403, like another user’s', async () => {
    const alice = await newUser();
    const res = await call('POST', '/v1/listings', alice.token, {
      title: 'Stove',
      pickup_location_id: randomUUID(),
    });
    expect(res.status).toBe(403);
  });
});

describe('public point under concurrency (R2.3)', () => {
  it('a listing switched to a location while it moves ends with the new point', async () => {
    const { updatePickupLocation } = await import('./service.ts');
    const alice = await newUser();
    const location = await createLocation(alice.token);
    const listing = await createListing(alice.token);

    // Transaction A moves the location and holds its lock until released.
    let moved!: () => void;
    let release!: () => void;
    const movedSignal = new Promise<void>((r) => (moved = r));
    const gate = new Promise<void>((r) => (release = r));
    const a = t.db.transaction(async (tx) => {
      const result = await updatePickupLocation(tx, alice.id, location.id, { lat: 45.53, lng: -73.62 });
      moved();
      await gate;
      return result;
    });
    await movedSignal;

    // Request B attaches the listing to that location while A is still open.
    const b = call('PATCH', `/v1/listings/${listing.id}`, alice.token, {
      pickup_location_id: location.id,
    });
    await new Promise((r) => setTimeout(r, 300));
    release();
    const newLocation = await a;
    expect((await b).status).toBe(200);

    const after = await call('GET', `/v1/listings/${listing.id}`, alice.token);
    expect(after.body.public_point).toEqual(newLocation.public_point);
  });
});
