import { createMiddleware } from 'hono/factory';
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
  type JWK,
} from 'jose';
import { errorCodes } from '@gear/shared';
import { ApiError } from './errors.ts';

export type KeySet = { keys: JWK[] };
// Resolves to the caller, or null when the token is not valid.
export type VerifyToken = (token: string) => Promise<{ sub: string } | null>;

type VerifierOptions = { issuer: string; audience: string; fetchKeys: () => Promise<KeySet> };

// R1.2: verify locally against the project's signing keys, kept in memory.
// The first use loads the keys; a token with an unknown key id causes one refetch.
export function createTokenVerifier({ issuer, audience, fetchKeys }: VerifierOptions): VerifyToken {
  let kids = new Set<string>();
  let keySet: ReturnType<typeof createLocalJWKSet> | undefined;
  let loading: Promise<void> | undefined;

  function load(): Promise<void> {
    loading ??= fetchKeys()
      .then((jwks) => {
        kids = new Set(jwks.keys.flatMap((k) => (k.kid ? [k.kid] : [])));
        keySet = createLocalJWKSet(jwks);
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  }

  return async (token) => {
    let kid: string | undefined;
    try {
      kid = decodeProtectedHeader(token).kid;
    } catch {
      return null;
    }
    if (!kid) return null;
    if (!keySet || !kids.has(kid)) await load();
    if (!keySet || !kids.has(kid)) return null;

    try {
      const { payload } = await jwtVerify(token, keySet, {
        issuer,
        audience,
        algorithms: ['ES256', 'RS256'],
      });
      return typeof payload.sub === 'string' ? { sub: payload.sub } : null;
    } catch (error) {
      if (error instanceof joseErrors.JOSEError) return null;
      throw error;
    }
  };
}

export type AuthVariables = { userId: string; accessToken: string };

// R1.1: every route behind this needs a valid Supabase access token.
// R1.4: the first authenticated request creates the caller's users row.
export function requireAuth(
  verifyToken: VerifyToken,
  ensureUser: (userId: string) => Promise<void>,
) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const match = /^Bearer (\S+)$/.exec(header);
    const caller = match?.[1] ? await verifyToken(match[1]) : null;
    if (!match?.[1] || !caller) {
      throw new ApiError(401, errorCodes.unauthorized, 'A valid access token is required');
    }
    c.set('userId', caller.sub);
    c.set('accessToken', match[1]);
    await ensureUser(caller.sub);
    await next();
  });
}

// For routes open to anyone that show more to a signed-in caller (GET /v1/listings/:id).
// No header: anonymous. A header with an invalid token: 401, as on every other route.
export async function optionalCaller(
  verifyToken: VerifyToken,
  header: string | undefined,
): Promise<string | null> {
  if (!header) return null;
  const match = /^Bearer (\S+)$/.exec(header);
  const caller = match?.[1] ? await verifyToken(match[1]) : null;
  if (!caller) throw new ApiError(401, errorCodes.unauthorized, 'A valid access token is required');
  return caller.sub;
}
