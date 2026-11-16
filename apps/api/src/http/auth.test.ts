import { afterAll, describe, expect, it } from 'vitest';
import { bearer, keySource, makeSigningKey, signToken, testApp } from '../test/helpers.ts';

const t = await testApp();
afterAll(() => t.db.$client.end());

async function status(headers?: Record<string, string>) {
  const res = await t.app.request('/v1/me', { headers });
  return res.status;
}

describe('token handling (R1.1, R1.2, R1.3)', () => {
  it('returns 401 without a token', async () => {
    expect(await status()).toBe(401);
  });

  it('returns 401 for a malformed token', async () => {
    expect(await status({ Authorization: 'Bearer not.a.jwt' })).toBe(401);
    expect(await status({ Authorization: 'Basic abc' })).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const token = await signToken(t.key, { expiresIn: Math.floor(Date.now() / 1000) - 60 });
    expect(await status(bearer(token).headers)).toBe(401);
  });

  it('returns 401 for a wrong signature', async () => {
    const impostor = await makeSigningKey(t.key.kid); // same kid, different private key
    const token = await signToken(impostor);
    expect(await status(bearer(token).headers)).toBe(401);
  });

  it('returns 401 for a wrong issuer', async () => {
    const token = await signToken(t.key, { iss: 'https://evil.example.com/auth/v1' });
    expect(await status(bearer(token).headers)).toBe(401);
  });

  it('returns 401 for a wrong audience', async () => {
    const token = await signToken(t.key, { aud: 'anon' });
    expect(await status(bearer(token).headers)).toBe(401);
  });

  it('returns 200 for a valid token', async () => {
    const token = await signToken(t.key);
    expect(await status(bearer(token).headers)).toBe(200);
  });
});

describe('key set refetch (R1.2)', () => {
  it('fetches keys once, then serves from memory', async () => {
    const key = await makeSigningKey();
    const keys = keySource(key);
    const { app, db } = await testApp({ keys });
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/v1/me', bearer(await signToken(key)));
      expect(res.status).toBe(200);
    }
    expect(keys.fetches).toBe(1);
    await db.$client.end();
  });

  it('refetches exactly once for an unknown key id', async () => {
    const oldKey = await makeSigningKey();
    const keys = keySource(oldKey);
    const { app, db } = await testApp({ keys });
    await app.request('/v1/me', bearer(await signToken(oldKey)));
    expect(keys.fetches).toBe(1);

    // The project rotates to a new key.
    const newKey = await makeSigningKey();
    keys.keys = [oldKey, newKey];
    const res = await app.request('/v1/me', bearer(await signToken(newKey)));
    expect(res.status).toBe(200);
    expect(keys.fetches).toBe(2);

    // A kid that is still unknown after the refetch is a 401, after one refetch only.
    const stranger = await makeSigningKey();
    const res2 = await app.request('/v1/me', bearer(await signToken(stranger)));
    expect(res2.status).toBe(401);
    expect(keys.fetches).toBe(3);
    await db.$client.end();
  });
});
