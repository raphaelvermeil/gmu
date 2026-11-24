// Drizzle's view of the tables. The SQL migrations are the source of truth.
import { customType, date, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Points are read and written with raw SQL (PostGIS); Drizzle only knows the column exists.
const geography = customType<{ data: string }>({ dataType: () => 'geography(Point, 4326)' });
const daterange = customType<{ data: string }>({ dataType: () => 'daterange' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name'),
  avatarPath: text('avatar_path'),
  avatarPendingPath: text('avatar_pending_path'),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true, mode: 'date' }),
  ownerRatingAvg: numeric('owner_rating_avg', { precision: 3, scale: 2 }),
  ownerRatingCount: integer('owner_rating_count').notNull().default(0),
  renterRatingAvg: numeric('renter_rating_avg', { precision: 3, scale: 2 }),
  renterRatingCount: integer('renter_rating_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
});

export const pickupLocations = pgTable('pickup_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  address: text('address').notNull(),
  exactPoint: geography('exact_point').notNull(),
  publicPoint: geography('public_point').notNull(),
  precision: text('precision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const listings = pgTable('listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull(),
  pickupLocationId: uuid('pickup_location_id'),
  categoryId: uuid('category_id'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  condition: text('condition'),
  dailyPriceCents: integer('daily_price_cents'),
  depositCents: integer('deposit_cents').notNull().default(0),
  currency: text('currency').notNull().default('CAD'),
  publicPoint: geography('public_point'),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const listingImages = pgTable('listing_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').notNull(),
  storagePath: text('storage_path').notNull().unique(),
  position: integer('position').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const availabilityBlocks = pgTable('availability_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').notNull(),
  period: daterange('period').notNull(),
  kind: text('kind').notNull(),
  rentalItemId: uuid('rental_item_id').unique(),
});

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  renterId: uuid('renter_id').notNull(),
  name: text('name').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: text('status').notNull().default('draft'),
  originPoint: geography('origin_point'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const tripItems = pgTable('trip_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').notNull(),
  listingId: uuid('listing_id').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  dailyPriceCentsAtAdd: integer('daily_price_cents_at_add').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
