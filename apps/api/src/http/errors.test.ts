import { errorSchema } from '@gear/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { bearer, jsonBody, signToken, testApp } from '../test/helpers.ts';

const t = await testApp();
afterAll(() => t.db.$client.end());

describe('error shape (R1.6)', () => {
  it('401 has the error shape', async () => {
    const res = await t.app.request('/v1/me');
    expect(res.status).toBe(401);
    const body = errorSchema.strict().parse(await res.json());
    expect(body.code).toBe('unauthorized');
  });

  it('404 has the error shape', async () => {
    const res = await t.app.request('/v1/nothing-here', bearer(await signToken(t.key)));
    expect(res.status).toBe(404);
    const body = errorSchema.strict().parse(await res.json());
    expect(body.code).toBe('not_found');
  });

  it('a validation failure is a 400 with the error shape and details', async () => {
    const token = await signToken(t.key);
    const res = await t.app.request('/v1/me', jsonBody(token, { display_name: '' }));
    expect(res.status).toBe(400);
    const body = errorSchema.strict().parse(await res.json());
    expect(body.code).toBe('validation_failed');
    expect(body.details).toBeDefined();
  });

  it('malformed JSON is a 400 with the error shape', async () => {
    const token = await signToken(t.key);
    const res = await t.app.request('/v1/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(errorSchema.strict().parse(await res.json()).code).toBe('validation_failed');
  });
});
