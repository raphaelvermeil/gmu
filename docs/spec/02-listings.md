# Step 2: Listings

**Goal:** an owner can create a listing with photos, a category with size attributes, a daily price, a deposit and a pickup location, then publish it. Nothing public shows where the owner lives.

**Depends on:** step 1.

**Blocked until G2.1 is decided.** The proposal never says how an address becomes a point on the map.

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
| `categories` | `parent_id`, `slug`, `attribute_schema` | Two levels |
| `pickup_locations` | `user_id`, `address`, `exact_point`, `public_point`, `precision` | Points are `geography(Point, 4326)` |
| `listings` | `owner_id`, `pickup_location_id`, `category_id`, `title`, `description`, `condition`, `daily_price_cents`, `deposit_cents`, `currency`, `attributes`, `public_point`, `status`, search vector | Never hard-deleted |
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
| `GET /v1/categories` | The category tree with attribute schemas | Anyone |
| `GET`, `POST /v1/me/pickup-locations`, `PATCH /v1/me/pickup-locations/:id` | The caller's pickup locations, with address | Owner of the location |
| `GET /v1/me/listings` | The caller's listings, drafts included | Signed-in user |
| `POST /v1/listings`, `PATCH /v1/listings/:id` | Create and edit, including status | Owner |
| `GET /v1/listings/:id` | Listing detail with the public point only | Anyone for an active listing; the owner for any status |
| `POST /v1/listings/:id/images` | A signed upload URL | Owner |
| `DELETE /v1/listings/:id/images/:imageId` | Remove a photo | Owner |
| `PUT /v1/listings/:id/blocks` | Replace the blackout dates | Owner |

## Rules

Location:

- **R2.1** The server computes `public_point` when a pickup location is saved, from `exact_point` and `precision` only. The same inputs always give the same output.
- **R2.2** The default grid is about 1 km. The owner can choose a coarser one. Two addresses in the same cell share one public point.
- **R2.3** `listings.public_point` is a copy of its pickup location's `public_point`. A change to the location updates the copies in the same transaction.
- **R2.4** `address` and `exact_point` are returned only by the `/v1/me/pickup-locations` routes, to the location's owner. No listing response contains them, for any caller.
- **R2.5** A pickup location that a rental points at is not edited in place. A change creates a new row.

Listings:

- **R2.6** `status` is `draft`, `active`, `paused` or `archived`. Rows are never deleted.
- **R2.7** A listing can become active only when the owner's phone is verified, and it has a category, valid attributes, a price above zero, a pickup location and at least one verified photo.
- **R2.8** Archiving is refused with 409 while the listing has a rental in `requested`, `confirmed` or `active`. The test for this rule is written in step 5.
- **R2.9** Only the owner can edit a listing, its photos and its blocks. Anyone else gets 403.
- **R2.10** `attributes` is validated against the category's `attribute_schema`. Unknown keys are rejected.
- **R2.11** `daily_price_cents` is an integer above zero. `deposit_cents` is an integer of zero or more. Both are information for the two users. Nothing is charged.
- **R2.12** No category exists for cars, ropes, harnesses, helmets or avalanche gear.

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
- Attributes: a valid set passes, an unknown key fails, a wrong type fails.
- Blackout dates: an overlap returns 409. Two periods that touch (one ends on the 4th, the next starts on the 5th) are both accepted.
- Photo job: a fixture file that carries GPS metadata is rejected and deleted. A clean file is verified.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] You have created and published a listing from a phone and from web.
- [ ] You have read the snapping function and the migration that creates `availability_blocks`.

## Gaps filled

- **G2.1 How an address becomes a point (blocking).** The proposal stores an exact point and a public point but names no geocoder. Two options. (a) No geocoder: the owner sets the point from the device's location and types the address by hand. (b) A geocoding service called by the API, which I have not evaluated. The same choice decides where a renter's search starts from in step 3.
- **G2.2 The category list.** You write the categories and the attributes of each. Claude must not invent them.
- **G2.3 `attribute_schema` format.** Default: a list of `{ key, label, type, options?, unit? }` where `type` is `enum` or `number`.
- **G2.4 `condition` values.** Default: `like_new`, `good`, `fair`.
- **G2.5 Precision options and snapping method.** Default: `1km` and `5km`, snapping to the centre of a fixed grid cell. Have Claude show you the function and its tests before any other code uses it.
- **G2.6 Photo limits.** Default: JPEG only after re-encoding, 5 MB a file, 8 photos a listing.
- **G2.7 Where `availability_blocks` is created.** The build order puts it in step 5, but the search in step 3 filters on it. This spec creates the table and owner blackouts here.
- **G2.8 Editing a location in use.** R2.5 is my addition. Without it, an owner could change the address of a rental that is already confirmed.
- **G2.9 `verified_at` on `listing_images`** is my addition, so that R2.16 can be checked.
- **G2.10 Sized photo variants.** The proposal serves thumbnails through Supabase's storage transformation URL. I have not checked which Supabase plan includes that.
- **G2.11 Routes.** The `/v1/categories`, `/v1/me/pickup-locations`, `/v1/me/listings` and image delete routes are not in the proposal's endpoint table.
