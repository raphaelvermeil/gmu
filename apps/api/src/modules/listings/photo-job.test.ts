import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { createStorage } from '../../platform/storage.ts';
import {
  LOCAL_SECRET_KEY,
  LOCAL_SUPABASE_URL,
  ownerPool,
  send,
  signToken,
  testApp,
} from '../../test/helpers.ts';
import { verifyAvatar } from '../identity/jobs.ts';
import { verifyListingImage } from './jobs.ts';

const owner = ownerPool();
const t = await testApp();
const storage = createStorage(LOCAL_SUPABASE_URL, LOCAL_SECRET_KEY);
afterAll(async () => {
  await t.db.$client.end();
  await owner.end();
});

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

// Through the real routes and the real local Storage: create a listing, get an upload URL,
// upload the file the way the app does.
async function uploadPhoto(file: Buffer) {
  const token = await signToken(t.key, { sub: randomUUID() });
  const created = await t.app.request('/v1/listings', send('POST', token, { title: 'Kayak' }));
  expect(created.status).toBe(201);
  const listing = (await created.json()) as { id: string };

  const issued = await t.app.request(`/v1/listings/${listing.id}/images`, send('POST', token));
  expect(issued.status).toBe(201);
  const image = (await issued.json()) as {
    image_id: string;
    storage_path: string;
    upload_url: string;
  };

  const put = await fetch(image.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: new Uint8Array(file),
  });
  expect(put.status).toBe(200);
  return image;
}

async function imageRow(id: string) {
  const { rows } = await owner.query(
    'select verified_at from public.listing_images where id = $1',
    [id],
  );
  return rows[0] as { verified_at: Date | null } | undefined;
}

describe('photo verification job (R2.15)', () => {
  it('verifies a clean JPEG', async () => {
    const image = await uploadPhoto(await fixture('clean.jpg'));
    expect((await imageRow(image.image_id))?.verified_at).toBeNull();

    await verifyListingImage(t.db, storage, image.image_id);

    expect((await imageRow(image.image_id))?.verified_at).toBeInstanceOf(Date);
    expect(await storage.download('listing-photos', image.storage_path)).not.toBeNull();
  });

  it('rejects a JPEG with GPS metadata: the row and the file are deleted', async () => {
    const image = await uploadPhoto(await fixture('gps.jpg'));

    await verifyListingImage(t.db, storage, image.image_id);

    expect(await imageRow(image.image_id)).toBeUndefined();
    expect(await storage.download('listing-photos', image.storage_path)).toBeNull();
  });
});

describe('avatar complete (API convention: a repeated command returns the first result)', () => {
  it('a second complete after the check ran answers 200, not an error', async () => {
    const userId = randomUUID();
    const token = await signToken(t.key, { sub: userId });
    const issued = await t.app.request('/v1/me/avatar', send('POST', token));
    const avatar = (await issued.json()) as { storage_path: string; upload_url: string };
    await fetch(avatar.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array(await fixture('clean.jpg')),
    });
    expect((await t.app.request('/v1/me/avatar/complete', send('POST', token))).status).toBe(200);
    await verifyAvatar(t.db, storage, userId, avatar.storage_path);

    const again = await t.app.request('/v1/me/avatar/complete', send('POST', token));
    expect(again.status).toBe(200);
  });
});
