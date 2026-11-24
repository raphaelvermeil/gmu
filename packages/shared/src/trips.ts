import { z } from 'zod';
import { pointSchema } from './listings.ts';
import { countedDays, todayInToronto } from './search.ts';

// Step 4: trips.

// G4.6: the one check on trip and item dates, the same as search. Null when they are fine.
export function tripDateError(start: string, end: string): string | null {
  if (start <= todayInToronto()) return 'the start is before tomorrow';
  if (end < start) return 'the end is before the start';
  if (countedDays(start, end) > 30) return 'the range is over 30 days';
  return null;
}

// POST /v1/trips
export const createTripSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(60),
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    origin: pointSchema.optional(), // G4.2: stored snapped
  })
  .superRefine((v, ctx) => {
    const message = tripDateError(v.start_date, v.end_date);
    if (message) ctx.addIssue({ code: 'custom', message });
  });
export type CreateTrip = z.infer<typeof createTripSchema>;

// For the trip's renter only. `origin_point` is snapped (R4.11).
export const tripSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  status: z.enum(['draft', 'submitted']),
  origin_point: pointSchema.nullable(),
  created_at: z.iso.datetime({ offset: true }),
});
export type Trip = z.infer<typeof tripSchema>;
export const tripListSchema = z.object({
  trips: z.array(tripSchema),
  next_cursor: z.string().nullable(),
});

// POST /v1/trips/:id/items. Without dates, the trip's (R4.3). The service checks the dates.
export const addTripItemSchema = z
  .strictObject({
    listing_id: z.uuid(),
    start_date: z.iso.date().optional(),
    end_date: z.iso.date().optional(),
  })
  .refine((v) => (v.start_date === undefined) === (v.end_date === undefined), {
    message: 'start_date and end_date come together',
  });
export type AddTripItem = z.infer<typeof addTripItemSchema>;
export const tripItemSchema = z.object({
  id: z.uuid(),
  listing_id: z.uuid(),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
});
export type TripItem = z.infer<typeof tripItemSchema>;

// GET /v1/trips/:id (R4.6 to R4.11). Totals leave out `unavailable` items.
export const tripDetailItemSchema = z.object({
  id: z.uuid(),
  listing_id: z.uuid(),
  title: z.string(),
  photo_url: z.url().nullable(),
  mark: z.enum(['available', 'unavailable', 'price_changed']),
  daily_price_cents: z.number().int().nullable(),
  daily_price_cents_at_add: z.number().int(),
  line_total_cents: z.number().int().nullable(),
  deposit_cents: z.number().int(),
});
export const tripGroupSchema = z.object({
  owner: z.object({
    id: z.uuid(),
    display_name: z.string().nullable(),
    rating_avg: z.number().nullable(),
    rating_count: z.number().int(),
  }),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  days: z.number().int(),
  distance_m: z.number().int().nullable(),
  price_cents: z.number().int(),
  deposit_cents: z.number().int(),
  items: z.array(tripDetailItemSchema),
});
export type TripGroup = z.infer<typeof tripGroupSchema>;
export const tripDetailSchema = tripSchema.extend({
  currency: z.literal('CAD'),
  price_cents: z.number().int(),
  deposit_cents: z.number().int(),
  groups: z.array(tripGroupSchema),
});
export type TripDetail = z.infer<typeof tripDetailSchema>;
