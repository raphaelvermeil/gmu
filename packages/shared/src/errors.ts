import { z } from 'zod';

// R1.6: every error response has this shape.
export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof errorSchema>;

export const errorCodes = {
  unauthorized: 'unauthorized',
  notFound: 'not_found',
  validationFailed: 'validation_failed',
  phoneNotVerified: 'phone_not_verified',
  forbidden: 'forbidden',
  activationRefused: 'activation_refused',
  invalidStatusMove: 'invalid_status_move',
  blockConflict: 'block_conflict',
  photoLimit: 'photo_limit',
  lastVerifiedPhoto: 'last_verified_photo',
  requiredWhilePublished: 'required_while_published',
  ownListing: 'own_listing',
  tripFull: 'trip_full',
  internal: 'internal_error',
} as const;
