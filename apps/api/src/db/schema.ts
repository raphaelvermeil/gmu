// Drizzle's view of the tables. The SQL migrations are the source of truth.
import { integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name'),
  avatarPath: text('avatar_path'),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true, mode: 'date' }),
  ownerRatingAvg: numeric('owner_rating_avg', { precision: 3, scale: 2 }),
  ownerRatingCount: integer('owner_rating_count').notNull().default(0),
  renterRatingAvg: numeric('renter_rating_avg', { precision: 3, scale: 2 }),
  renterRatingCount: integer('renter_rating_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
