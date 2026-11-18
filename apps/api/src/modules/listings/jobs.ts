// R2.15: the photo job. A photo that passes gets `verified_at`; one that fails is deleted,
// file first, so a failed delete leaves the row for the retry.
import { eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { listingImages } from '../../db/schema.ts';
import type { Storage } from '../../platform/storage.ts';
import { checkPhoto } from './photo-check.ts';

export const LISTING_PHOTOS_BUCKET = 'listing-photos';

export async function verifyListingImage(tx: Tx, storage: Storage, imageId: string): Promise<void> {
  const [image] = await tx.select().from(listingImages).where(eq(listingImages.id, imageId));
  if (!image || image.verifiedAt) return; // deleted since, or already verified: nothing to do

  const bytes = await storage.download(LISTING_PHOTOS_BUCKET, image.storagePath);
  const check = bytes ? await checkPhoto(bytes) : null;
  if (check?.ok) {
    await tx
      .update(listingImages)
      .set({ verifiedAt: new Date() })
      .where(eq(listingImages.id, imageId));
    return;
  }
  if (bytes) await storage.remove(LISTING_PHOTOS_BUCKET, image.storagePath);
  await tx.delete(listingImages).where(eq(listingImages.id, imageId));
}
