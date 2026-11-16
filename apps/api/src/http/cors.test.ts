import { describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';

const preflight = (origin: string) => ({
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'PATCH',
    'Access-Control-Request-Headers': 'authorization,content-type',
  },
});

describe('CORS for the web app', () => {
  it('allows a listed origin', async () => {
    const { app, db } = await testApp();
    const res = await app.request('/v1/me', preflight('http://localhost:8081'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8081');
    await db.$client.end();
  });

  it('does not allow an unlisted origin', async () => {
    const { app, db } = await testApp();
    const res = await app.request('/v1/me', preflight('https://evil.example.com'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    await db.$client.end();
  });
});
