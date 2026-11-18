// G2.14: the avatar goes through the same check as listing photos (R2.15).
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { users } from '../../db/schema.ts';
import type { Storage } from '../../platform/storage.ts';
import { checkPhoto } from '../listings/photo-check.ts';
import { AVATARS_BUCKET } from './service.ts';

export async function verifyAvatar(
  tx: Tx,
  storage: Storage,
  userId: string,
  path: string,
): Promise<void> {
  const pending = and(eq(users.id, userId), eq(users.avatarPendingPath, path));
  const [row] = await tx.select({ id: users.id }).from(users).where(pending);
  if (!row) return; // replaced by a newer upload, or already handled

  const bytes = await storage.download(AVATARS_BUCKET, path);
  const check = bytes ? await checkPhoto(bytes) : null;
  if (check?.ok) {
    await tx.update(users).set({ avatarPath: path, avatarPendingPath: null }).where(pending);
    return;
  }
  if (bytes) await storage.remove(AVATARS_BUCKET, path);
  await tx.update(users).set({ avatarPendingPath: null }).where(pending);
}
