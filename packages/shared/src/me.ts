import { z } from 'zod';

// Output schema for GET/PATCH /v1/me and POST /v1/me/phone.
// A column is exposed only once it is named here.
export const meSchema = z.object({
  id: z.uuid(),
  display_name: z.string().nullable(),
  avatar_url: z.url().nullable(),
  avatar_pending: z.boolean(), // an uploaded avatar is waiting for its check (G2.14)
  phone_verified_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
});
export type Me = z.infer<typeof meSchema>;

// Input schema for PATCH /v1/me. Strict: no other field, and no user id (R1.5).
export const updateMeSchema = z.strictObject({
  display_name: z.string().trim().min(1).max(60),
});
export type UpdateMe = z.infer<typeof updateMeSchema>;
