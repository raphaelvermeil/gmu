# Step 2: Listings

**Goal:** an owner can create a listing with photos, a category, a daily price, a deposit and a pickup location, then publish it. Nothing public shows where the owner lives.

**Depends on:** step 1.

G2.1 is decided: the owner's device sets the point (see Gaps filled).

## In scope

- Categories, seeded by a migration.
- Pickup locations, with the snapped public point.
- Listings: create, edit, status changes.
- Photos: signed uploads, resizing in the app, verification in a worker job.
- Owner blackout dates, and the `availability_blocks` table with its exclusion constraint.
- The job queue. Photo verification is its first job.
- Avatar upload, using the same signed-upload path.

## Out of scope

- Search and the public listing page (step 3).
- Rental blocks in `availability_blocks` (step 5).

## Data

| Table | Fields | Notes |
| --- | --- | --- |
| `categories` | `slug`, `label` | One level, no attributes |
| `pickup_locations` | `user_id`, `address`, `exact_point`, `public_point`, `precision` | Points are `geography(Point, 4326)` |
| `listings` | `owner_id`, `pickup_location_id`, `category_id`, `title`, `description`, `condition`, `daily_price_cents`, `deposit_cents`, `currency`, `public_point`, `status`, search vector | Never hard-deleted |
| `listing_images` | `listing_id`, `storage_path`, `position`, `verified_at` | Paths are immutable |
| `availability_blocks` | `listing_id`, `period`, `kind`, `rental_item_id` | See below |

```sql
create table availability_blocks (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid not null references listings(id),
  period         daterange not null,
  kind           text not null check (kind in ('owner_block', 'rental')),
  rental_item_id uuid unique,
  check ((kind = 'rental') = (rental_item_id is not null)),
  exclude using gist (listing_id with =, period with &&)
);
```

Step 5 adds the foreign key from `rental_item_id` to `rental_items(id)` with `on delete cascade`.

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `GET /v1/categories` | The list of categories | Anyone |
| `GET`, `POST /v1/me/pickup-locations`, `PATCH /v1/me/pickup-locations/:id` | The caller's pickup locations, with address | Owner of the location |
| `GET /v1/me/listings` | The caller's listings, drafts included | Signed-in user |
| `POST /v1/listings`, `PATCH /v1/listings/:id` | Create and edit the fields. PATCH does not take `status` | Owner |
| `POST /v1/listings/:id/publish`, `/pause`, `/archive` | Status commands (G2.12) | Owner |
| `GET /v1/listings/:id` | Listing detail with the public point only | Anyone for an active listing; the owner for any status |
| `POST /v1/listings/:id/images` | A signed upload URL | Owner |
| `POST /v1/listings/:id/images/:imageId/complete` | The upload finished; queue the photo check | Owner |
| `POST /v1/me/avatar`, `POST /v1/me/avatar/complete` | A signed upload URL for the avatar; queue its check | Signed-in user |
| `DELETE /v1/listings/:id/images/:imageId` | Remove a photo | Owner |
| `GET`, `PUT /v1/listings/:id/blocks` | Read and replace the blackout dates | Owner |

## Rules

Location:

- **R2.1** The server computes `public_point` when a pickup location is saved, from `exact_point` and `precision` only. The same inputs always give the same output.
- **R2.2** The default grid is about 1 km. The owner can choose a coarser one. Two addresses in the same cell share one public point.
- **R2.3** `listings.public_point` is a copy of its pickup location's `public_point`. A change to the location updates the copies in the same transaction.
- **R2.4** `address` and `exact_point` are returned only by the `/v1/me/pickup-locations` routes, to the location's owner. No listing response contains them, for any caller.
- **R2.5** A pickup location that a rental points at is not edited in place. A change creates a new row.

Listings:

- **R2.6** `status` is `draft`, `active`, `paused` or `archived`. Rows are never deleted.
- **R2.7** A listing can become active only when the owner's phone is verified, and it has a category, a price above zero, a pickup location and at least one verified photo.
- **R2.8** Archiving is refused with 409 while the listing has a rental in `requested`, `confirmed` or `active`. The test for this rule is written in step 5.
- **R2.9** Only the owner can edit a listing, its photos and its blocks. Anyone else gets 403.
- **R2.10** Removed on 17 November 2026. Listings have no attributes; the owner describes the gear in the description.
- **R2.11** `daily_price_cents` is an integer above zero. `deposit_cents` is an integer of zero or more. Both are information for the two users. Nothing is charged.
- **R2.12** Removed on 17 November 2026. Any gear may be listed. The safety of the gear is the two users' responsibility; the app does not check it.

Photos:

- **R2.13** The API issues a signed upload URL limited by content type and size. The API never receives image bytes.
- **R2.14** The app resizes each photo to a long edge of about 2,000 px and re-encodes it before upload.
- **R2.15** A worker job checks each uploaded photo for an allowed type, an allowed size and the absence of location metadata. A photo that passes gets `verified_at`. A photo that fails is deleted.
- **R2.16** Only verified photos count toward R2.7 and appear in responses to callers other than the owner.
- **R2.17** A replacement photo gets a new path. An existing path is never overwritten.

Blackout dates and the queue:

- **R2.18** `PUT /v1/listings/:id/blocks` replaces the listing's owner blocks. A period that overlaps another block is refused by the exclusion constraint and returns 409.
- **R2.19** A period is stored as `[start, end + 1 day)`, which is how an inclusive end date is expressed.
- **R2.20** pg-boss runs in the same database, and the worker runs inside the API process. `/healthz` now also checks the queue.

## Tests to write first

- Snapping is deterministic. Two points in one cell give the same public point. A coarser precision gives a larger cell. The public point is never farther from the exact point than the cell allows.
- Privacy: every route in this step except `/v1/me/pickup-locations`, called as the owner, as another user and with no token, returns no `address` key, no `exact_point` key and no coordinate equal to the exact point.
- Changing a pickup location updates `listings.public_point` for all its listings, or for none if the transaction fails.
- Activation is refused once for each missing precondition in R2.7.
- A non-owner edit of a listing, a photo or the blocks returns 403.
- Blackout dates: an overlap returns 409. Two periods that touch (one ends on the 4th, the next starts on the 5th) are both accepted.
- Photo job: a fixture file that carries GPS metadata is rejected and deleted. A clean file is verified.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] You have created and published a listing from a phone and from web.
- [ ] You have read the snapping function and the migration that creates `availability_blocks`.

## Gaps filled

Decided with the owner on 17 November 2026.

- **G2.1 How an address becomes a point.** No geocoder. The owner sets the point from the device's location (`expo-location`) and types the address by hand. Step 3 starts a renter's search from the device's location the same way.
- **G2.2 The category list.** One level, chosen by the owner on 17 November 2026: `camping` Camping, `climbing` Climbing, `water` Water, `snow` Snow, `ski` Ski, `other` Other. A category says what kind of gear it is, not which item: a listing under Camping can be a sleeping bag or a whole kit. There are no sub-categories and no attributes. The owner writes sizes and specs in the description.
- **G2.3 `attribute_schema` format.** Removed with the attributes (see G2.2).
- **G2.4 `condition` values.** `like_new`, `good`, `fair`.
- **G2.5 Precision options and snapping method.** `1km` and `5km`. A fixed grid in degrees sized for Montreal: a `1km` cell is 0.009° of latitude by 0.0128° of longitude, a `5km` cell is five times that. A point snaps to the centre of its cell. Have Claude show you the function and its tests before any other code uses it.
- **G2.6 Photo limits.** JPEG only after re-encoding, 5 MB a file, 8 photos a listing. The limits are set on the `listing-photos` bucket, and the job checks them again. Photos still waiting for the check count toward the 8.
- **G2.7 Where `availability_blocks` is created.** The build order puts it in step 5, but the search in step 3 filters on it. This spec creates the table and owner blackouts here.
- **G2.8 Editing a location in use.** R2.5 is built in step 5, with the `rentals` table. Until then a location is edited in place. R2.8 is also built in step 5.
- **G2.9 `verified_at` on `listing_images`** is added so that R2.16 can be checked.
- **G2.10 Sized photo variants.** None. Each listing serves the one photo the app resized. Supabase's transformation URLs need a paid plan.
- **G2.11 Routes.** The `/v1/categories`, `/v1/me/pickup-locations`, `/v1/me/listings` and image delete routes are not in the proposal's endpoint table. The image `complete` and the avatar routes were added on 17 November 2026: the API learns an upload finished when the app calls `complete`, which queues the check.
- **G2.12 Status moves.** Each move is a command, as the API conventions require: `publish` moves `draft` or `paused` to `active`, `pause` moves `active` to `paused`, and `archive` moves `draft`, `active` or `paused` to `archived`. That is `draft` → `active`, `active` → `paused`, `paused` → `active`, and `draft`, `active` or `paused` → `archived`. `archived` is final. R2.7 is checked on every move to `active`. Any other move returns 409.
- **G2.13 Removing the last verified photo** of an active listing is refused with 409. Removing a photo deletes its file and its row.
- **G2.14 Avatars** go through the same check as listing photos. `users.avatar_path` is set only when the photo passes. A repeated `complete` after the check ran returns `done`, not an error.
- **G2.15 Search vector.** A generated `tsvector` over title and description, with the `simple` configuration.
- **G2.16 Small rules.** `GET /v1/listings/:id` returns 404, not 403, for a listing that is not active and a caller who is not the owner. `currency` is always `CAD`, set by the server. A listing may only use one of its owner's pickup locations; any other location returns 403. A blackout period that ends before it starts returns 400.
- **G2.17 New packages, approved:** `pg-boss` and `exifr` in the API; `expo-image-picker`, `expo-image-manipulator` and `expo-location` in the app.
- **G2.18 Reading blackout dates.** Added on 17 November 2026: `GET /v1/listings/:id/blocks` returns the owner's blackout dates, in the shape `PUT` returns, so the app can show them. Owner only; anyone else gets 403. Step 3's public availability route is separate.
- **G2.19 R2.7 while published.** Added on 17 November 2026: an edit that removes the category, the price or the pickup location of an `active` listing returns 409 with `required_while_published`. The owner pauses the listing first.
