import { describe, expect, it } from 'vitest';
import { createDb } from '../db/client.ts';
import { testApp } from '../test/helpers.ts';

describe('/healthz (R1.10)', () => {
  it('returns 200 when the database answers', async () => {
    const { app, db } = await testApp();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    await db.$client.end();
  });

  it('returns 503 when the database is unreachable', async () => {
    const db = createDb('postgresql://api:api@127.0.0.1:1/postgres');
    const { app } = await testApp({ db });
    const res = await app.request('/healthz');
    expect(res.status).toBe(503);
    await db.$client.end();
  });

  it('needs no token', async () => {
    const { app, db } = await testApp();
    expect((await app.request('/healthz')).status).not.toBe(401);
    await db.$client.end();
  });
});
