import { eq } from 'drizzle-orm';
import { meSchema, type Me } from '@gear/shared';
import type { Tx } from '../../db/client.ts';
import { users } from '../../db/schema.ts';

type UserRow = typeof users.$inferSelect;

// R1.4: creates the users row for a new auth user; does nothing for a known one.
export async function ensureUser(tx: Tx, userId: string): Promise<void> {
  const existing = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (existing.length > 0) return;
  await tx.insert(users).values({ id: userId }).onConflictDoNothing();
}

export async function getMe(tx: Tx, userId: string): Promise<Me> {
  const [row] = await tx.select().from(users).where(eq(users.id, userId));
  if (!row) throw new Error('users row missing for an authenticated caller');
  return toMe(row);
}

export async function updateDisplayName(tx: Tx, userId: string, displayName: string): Promise<Me> {
  const [row] = await tx.update(users).set({ displayName }).where(eq(users.id, userId)).returning();
  if (!row) throw new Error('users row missing for an authenticated caller');
  return toMe(row);
}

// R1.11: the caller passes the time read from Supabase Auth, never a client value.
export async function setPhoneVerifiedAt(tx: Tx, userId: string, at: Date): Promise<Me> {
  const [row] = await tx
    .update(users)
    .set({ phoneVerifiedAt: at })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new Error('users row missing for an authenticated caller');
  return toMe(row);
}

// R1.7: the response is built from the output schema, not the row.
function toMe(row: UserRow): Me {
  return meSchema.parse({
    id: row.id,
    display_name: row.displayName,
    phone_verified_at: row.phoneVerifiedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  });
}
