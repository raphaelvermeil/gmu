// Thin wrapper over Supabase Storage's HTTP API, called with the secret key. No business rules here.
// R2.13: the API hands out signed upload URLs and never receives image bytes from a client.
export type Storage = {
  // An absolute URL the app PUTs the file to. Without upsert, so a path is never overwritten (R2.17).
  createSignedUploadUrl(bucket: string, path: string): Promise<{ url: string }>;
  // Null when the object does not exist.
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  remove(bucket: string, path: string): Promise<void>;
  publicUrl(bucket: string, path: string): string;
};

// `publicUrl` is Supabase as clients reach it, for the links handed to them. It differs from
// `supabaseUrl` only in local development on a phone, where 127.0.0.1 is the phone itself.
export function createStorage(
  supabaseUrl: string,
  secretKey: string,
  publicUrl: string = supabaseUrl,
): Storage {
  const base = `${supabaseUrl}/storage/v1`;
  const publicBase = `${publicUrl}/storage/v1`;
  const headers = { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
  const object = (bucket: string, path: string) =>
    `${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;

  return {
    async createSignedUploadUrl(bucket, path) {
      const res = await fetch(`${base}/object/upload/sign/${object(bucket, path)}`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) throw new Error(`Storage upload/sign answered ${res.status}`);
      const body = (await res.json()) as { url: string };
      return { url: `${publicBase}${body.url}` };
    },

    async download(bucket, path) {
      const res = await fetch(`${base}/object/authenticated/${object(bucket, path)}`, { headers });
      if (res.status === 404 || res.status === 400) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) throw new Error(`Storage download answered ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async remove(bucket, path) {
      const res = await fetch(`${base}/object/${encodeURIComponent(bucket)}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] }),
      });
      if (!res.ok) throw new Error(`Storage delete answered ${res.status}`);
      await res.body?.cancel();
    },

    publicUrl(bucket, path) {
      return `${publicBase}/object/public/${object(bucket, path)}`;
    },
  };
}
