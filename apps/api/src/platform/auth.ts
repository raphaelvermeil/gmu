// Thin wrappers over Supabase Auth's HTTP API. No business rules here.
import type { KeySet } from '../http/auth.ts';

export type AuthApi = {
  // The caller's own record in Supabase Auth, read with the caller's access token.
  // Null when Auth rejects the token, e.g. after a sign-out on another device.
  getUser(accessToken: string): Promise<{ phone_confirmed_at: string | null } | null>;
};

export function createAuthApi(supabaseUrl: string, publishableKey: string): AuthApi {
  return {
    async getUser(accessToken) {
      const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error(`Supabase Auth /user answered ${res.status}`);
      const body = (await res.json()) as { phone_confirmed_at?: string | null };
      return { phone_confirmed_at: body.phone_confirmed_at ?? null };
    },
  };
}

export function jwksFetcher(supabaseUrl: string): () => Promise<KeySet> {
  return async () => {
    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) throw new Error(`Supabase Auth JWKS answered ${res.status}`);
    return (await res.json()) as KeySet;
  };
}
