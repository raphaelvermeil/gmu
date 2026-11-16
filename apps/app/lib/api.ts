import type { AppType } from '@gear/api/app';
import type { ApiErrorBody } from '@gear/shared';
import { hc } from 'hono/client';
import { config } from './config';
import { supabase } from './supabase';

// The one typed client for the API. API types are imported with `import type` only.
export const api = hc<AppType>(config.apiUrl, {
  headers: async (): Promise<Record<string, string>> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? `Request failed with ${status}`);
  }
}

// Turns a non-2xx response into an ApiRequestError carrying the shared error shape.
type JsonResponse<T> = { ok: boolean; status: number; json(): Promise<T> };

export async function ok<T>(response: Promise<JsonResponse<T>>): Promise<T> {
  const res = await response;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiRequestError(res.status, body);
  }
  return res.json();
}
