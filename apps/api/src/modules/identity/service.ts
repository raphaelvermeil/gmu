import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { meSchema, type Me, type PhotoUpload } from '@gear/shared';
import type { Tx } from '../../db/client.ts';
import { users } from '../../db/schema.ts';
import { QUEUES, type Queue } from '../../platform/queue.ts';
import type { Storage } from '../../platform/storage.ts';

type UserRow = typeof users.$inferSelect;

export const AVATARS_BUCKET = 'avatars';

// R1.4: creates the users row for a new auth user; does nothing for a known one.
export async function ensureUser(tx: Tx, userId: string): Promise<void> {
  const existing = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (existing.length > 0) return;
  await tx.insert(users).values({ id: userId }).onConflictDoNothing();
}

export async function getMe(tx: Tx, storage: Storage, userId: string): Promise<Me> {
  return toMe(await userRow(tx, userId), storage);
}

// R2.7: for other modules, which do not read `users` themselves.
export async function isPhoneVerified(tx: Tx, userId: string): Promise<boolean> {
  return (await userRow(tx, userId)).phoneVerifiedAt !== null;
}

export async function updateDisplayName(
  tx: Tx,
  storage: Storage,
  userId: string,
  displayName: string,
): Promise<Me> {
  const [row] = await tx.update(users).set({ displayName }).where(eq(users.id, userId)).returning();
  if (!row) throw new Error('users row missing for an authenticated caller');
  return toMe(row, storage);
}

// R1.11: the caller passes the time read from Supabase Auth, never a client value.
export async function setPhoneVerifiedAt(
  tx: Tx,
  storage: Storage,
  userId: string,
  at: Date,
): Promise<Me> {
  const [row] = await tx
    .update(users)
    .set({ phoneVerifiedAt: at })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new Error('users row missing for an authenticated caller');
  return toMe(row, storage);
}

// G2.14: a new path for every upload (R2.17); it waits in `avatar_pending_path` until checked.
export async function issueAvatarUpload(
  tx: Tx,
  storage: Storage,
  userId: string,
): Promise<PhotoUpload> {
  const path = `${userId}/${randomUUID()}.jpg`;
  await tx.update(users).set({ avatarPendingPath: path }).where(eq(users.id, userId));
  const { url } = await storage.createSignedUploadUrl(AVATARS_BUCKET, path);
  return { storage_path: path, upload_url: url };
}

// Nothing waiting means the check already ran: a repeated command returns success.
export async function completeAvatarUpload(
  tx: Tx,
  queue: Queue,
  userId: string,
): Promise<'queued' | 'done'> {
  const path = (await userRow(tx, userId)).avatarPendingPath;
  if (!path) return 'done';
  await queue.send(QUEUES.verifyPhoto, { kind: 'avatar', user_id: userId, path });
  return 'queued';
}

async function userRow(tx: Tx, userId: string): Promise<UserRow> {
  const [row] = await tx.select().from(users).where(eq(users.id, userId));
  if (!row) throw new Error('users row missing for an authenticated caller');
  return row;
}

// R1.7: the response is built from the output schema, not the row.
function toMe(row: UserRow, storage: Storage): Me {
  return meSchema.parse({
    id: row.id,
    display_name: row.displayName,
    avatar_url: row.avatarPath ? storage.publicUrl(AVATARS_BUCKET, row.avatarPath) : null,
    avatar_pending: row.avatarPendingPath !== null,
    phone_verified_at: row.phoneVerifiedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  });
}
