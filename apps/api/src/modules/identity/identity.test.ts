import { randomUUID } from 'node:crypto';
import { meSchema } from '@gear/shared';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bearer,
  fakeAuthApi,
  jsonBody,
  ownerPool,
  signToken,
  testApp,
} from '../../test/helpers.ts';

const owner = ownerPool();
const t = await testApp();
afterAll(async () => {
  await t.db.$client.end();
  await owner.end();
});

async function countUsers(id: string): Promise<number> {
  const { rows } = await owner.query('select count(*)::int as n from public.users where id = $1', [
    id,
  ]);
  return rows[0].n;
}

describe('users row creation (R1.4)', () => {
  it('the first request creates one users row; a second creates none', async () => {
    const sub = randomUUID();
    const token = await signToken(t.key, { sub });
    expect(await countUsers(sub)).toBe(0);

    const first = await t.app.request('/v1/me', bearer(token));
    expect(first.status).toBe(200);
    expect(await countUsers(sub)).toBe(1);

    const second = await t.app.request('/v1/me', bearer(token));
    expect(second.status).toBe(200);
    expect(await countUsers(sub)).toBe(1);

    const me = meSchema.strict().parse(await second.json());
    expect(me.id).toBe(sub);
  });

  it('concurrent first requests still create one row', async () => {
    const sub = randomUUID();
    const token = await signToken(t.key, { sub });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => t.app.request('/v1/me', bearer(token))),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await countUsers(sub)).toBe(1);
  });
});

describe('PATCH /v1/me (R1.5)', () => {
  it('changes only the caller row', async () => {
    const alice = randomUUID();
    const bob = randomUUID();
    const aliceToken = await signToken(t.key, { sub: alice });
    const bobToken = await signToken(t.key, { sub: bob });
    await t.app.request('/v1/me', jsonBody(bobToken, { display_name: 'Bob' }));

    const res = await t.app.request('/v1/me', jsonBody(aliceToken, { display_name: ' Alice ' }));
    expect(res.status).toBe(200);
    expect(meSchema.strict().parse(await res.json()).display_name).toBe('Alice');

    const { rows } = await owner.query(
      'select id, display_name from public.users where id = any($1) order by display_name',
      [[alice, bob]],
    );
    expect(rows).toEqual([
      { id: alice, display_name: 'Alice' },
      { id: bob, display_name: 'Bob' },
    ]);
  });

  it('rejects a body that names a user id', async () => {
    const victim = randomUUID();
    const token = await signToken(t.key);
    const res = await t.app.request(
      '/v1/me',
      jsonBody(token, { id: victim, display_name: 'Mallory' }),
    );
    expect(res.status).toBe(400);
    expect(await countUsers(victim)).toBe(0);
  });
});

describe('POST /v1/me/phone (R1.11)', () => {
  it('copies phone_confirmed_at from Supabase Auth, using the caller token', async () => {
    const confirmedAt = '2026-11-16T12:00:00.000Z';
    const fake = fakeAuthApi(confirmedAt);
    const { app, db, key } = await testApp({ authApi: fake.authApi });
    const token = await signToken(key);

    const res = await app.request('/v1/me/phone', { method: 'POST', ...bearer(token) });
    expect(res.status).toBe(200);
    const me = meSchema.strict().parse(await res.json());
    expect(new Date(me.phone_verified_at!).toISOString()).toBe(confirmedAt);
    expect(fake.calls).toEqual([token]);
    await db.$client.end();
  });

  it('ignores a value the client sends and returns 409 when Auth has no confirmation', async () => {
    const { app, db, key } = await testApp({ authApi: fakeAuthApi(null).authApi });
    const sub = randomUUID();
    const token = await signToken(key, { sub });

    const res = await app.request('/v1/me/phone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_verified_at: '2026-01-01T00:00:00Z' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('phone_not_verified');

    const { rows } = await owner.query('select phone_verified_at from public.users where id = $1', [
      sub,
    ]);
    expect(rows[0]?.phone_verified_at ?? null).toBeNull();
    await db.$client.end();
  });
});
