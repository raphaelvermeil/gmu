import { randomUUID } from 'node:crypto';
import { todayInToronto } from '@gear/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { ownerPool, send, signToken, testApp } from '../../test/helpers.ts';
import { snapToGrid } from '../listings/snap.ts';

const owner = ownerPool();
const t = await testApp();

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
