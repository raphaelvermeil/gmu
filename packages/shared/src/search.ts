import { z } from 'zod';
import { categorySchema, pointSchema } from './listings.ts';

// Step 3: search and availability.

const queryNumber = z.string().trim().min(1).pipe(z.coerce.number());
const DAY_MS = 86_400_000;
// Both ends count (G3.4).
const countedDays = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;

// Today's calendar date at the pickup locations (launch market: Montreal).
export function todayInToronto(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// GET /v1/listings
export const searchQuerySchema = z
  .object({
    lat: queryNumber.pipe(pointSchema.shape.lat),
    lng: queryNumber.pipe(pointSchema.shape.lng),
    // R3.4, G3.1: above the maximum is lowered to it.
    radius_km: queryNumber
      .pipe(z.number().positive())
      .transform((km) => Math.min(km, 100))
      .default(25),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    category: z.uuid().optional(),
    q: z.string().trim().max(200).optional(),
    sort: z.enum(['distance', 'price']).default('distance'),
    cursor: z.string().optional(),
    limit: queryNumber.pipe(z.number().int().min(1).max(30)).default(30), // R3.7
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: 'from and to come together',
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { message: 'to is before from' })
  .refine((v) => !v.from || v.from > todayInToronto(), { message: 'from is before tomorrow' })
  .refine((v) => !v.from || !v.to || countedDays(v.from, v.to) <= 30, {
    message: 'the range is over 30 days',
  });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

// R3.8, G3.10: no coordinates.
export const searchResultSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  daily_price_cents: z.number().int(),
  deposit_cents: z.number().int(),
  currency: z.literal('CAD'),
  photo_url: z.url().nullable(),
  distance_m: z.number().int(),
  category: categorySchema,
  owner: z.object({
    display_name: z.string().nullable(),
    rating_avg: z.number().nullable(),
    rating_count: z.number().int(),
  }),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export const searchResponseSchema = z.object({
  listings: z.array(searchResultSchema),
  next_cursor: z.string().nullable(),
});

// GET /v1/listings/:id/availability (R3.10, G3.6). Dates are inclusive.
export const availabilityQuerySchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.to >= v.from, { message: 'to is before from' })
  .refine((v) => countedDays(v.from, v.to) <= 366, { message: 'the window is over 366 days' });
export const availabilitySchema = z.object({
  taken: z.array(z.object({ start: z.iso.date(), end: z.iso.date() })),
});
