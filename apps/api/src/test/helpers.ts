import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import pg from 'pg';
import { createApp } from '../http/app.ts';
import { createTokenVerifier, type KeySet } from '../http/auth.ts';
import { createDb, type Db } from '../db/client.ts';
import { LOCAL_API_URL, LOCAL_OWNER_URL } from '../db/local-setup.ts';
import type { AuthApi } from '../platform/auth.ts';
import { createQueue } from '../platform/queue.ts';
import { createStorage } from '../platform/storage.ts';

export const ISSUER = 'http://127.0.0.1:54321/auth/v1';
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
// The fixed publishable key of every local `supabase start` stack. Not a secret.
export const LOCAL_PUBLISHABLE_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
// The local stack's secret key, set by global-setup.ts from `supabase status`.
// Read at run time so no key in the secret format is ever committed.
export const LOCAL_SECRET_KEY = process.env.LOCAL_SUPABASE_SECRET_KEY ?? '';
if (!LOCAL_SECRET_KEY) throw new Error('LOCAL_SUPABASE_SECRET_KEY is not set: is `supabase start` running?');

export type SigningKey = { kid: string; privateKey: CryptoKey; jwk: JWK };

export async function makeSigningKey(kid: string = randomUUID()): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  return { kid, privateKey, jwk };
}

type TokenOptions = { sub?: string; iss?: string; aud?: string; expiresIn?: string | number };

export async function signToken(key: SigningKey, options: TokenOptions = {}): Promise<string> {
  return new SignJWT({ role: 'authenticated', session_id: randomUUID() })
    .setProtectedHeader({ alg: 'ES256', kid: key.kid, typ: 'JWT' })
    .setSubject(options.sub ?? randomUUID())
    .setIssuer(options.iss ?? ISSUER)
    .setAudience(options.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(key.privateKey);
}

// A key-set source the test controls, counting each fetch.
export function keySource(...keys: SigningKey[]) {
  const source = {
    keys,
    fetches: 0,
    fetchKeys: async (): Promise<KeySet> => {
      source.fetches += 1;
      return { keys: source.keys.map((k) => k.jwk) };
    },
  };
  return source;
}

export function fakeAuthApi(phoneConfirmedAt: string | null = null) {
  const calls: string[] = [];
  const authApi: AuthApi = {
    getUser: async (accessToken) => {
      calls.push(accessToken);
      return { phone_confirmed_at: phoneConfirmedAt };
    },
  };
  return { authApi, calls };
}

type TestAppOptions = { db?: Db; keys?: ReturnType<typeof keySource>; authApi?: AuthApi };

export async function testApp(options: TestAppOptions = {}) {
  const key = await makeSigningKey();
  const keys = options.keys ?? keySource(key);
  const db = options.db ?? createDb(LOCAL_API_URL);
  const verifyToken = createTokenVerifier({
    issuer: ISSUER,
    audience: 'authenticated',
    fetchKeys: keys.fetchKeys,
  });
  // The real local Storage and queue; the queue opens connections only when first used.
  const storage = createStorage(LOCAL_SUPABASE_URL, LOCAL_SECRET_KEY);
  const queue = createQueue(LOCAL_API_URL);
  const app = createApp({
    db,
    verifyToken,
    authApi: options.authApi ?? fakeAuthApi().authApi,
    storage,
    queue,
    corsOrigins: ['http://localhost:8081'],
    log: () => {},
  });
  return { app, db, key, keys, storage, queue };
}

export function ownerPool(): pg.Pool {
  return new pg.Pool({ connectionString: LOCAL_OWNER_URL, max: 2 });
}

export function bearer(token: string): { headers: Record<string, string> } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

export function jsonBody(token: string, body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Any method, with an optional token and JSON body.
export function send(method: string, token?: string, body?: unknown): RequestInit {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
}
