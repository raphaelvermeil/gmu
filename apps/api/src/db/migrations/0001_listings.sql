-- Step 2: categories, pickup locations, listings, photos, availability blocks, photo buckets.
-- Runs as `postgres`, which owns every table (G1.3). The `api` role gets explicit grants.

-- G2.2: one level, no attributes. Seeded here; there is no admin route.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  position integer not null
);

insert into public.categories (slug, label, position) values
  ('camping', 'Camping', 1),
  ('climbing', 'Climbing', 2),
  ('water', 'Water', 3),
  ('snow', 'Snow', 4),
  ('ski', 'Ski', 5),
  ('other', 'Other', 6);

-- R2.1, R2.2: `public_point` is computed by the API from `exact_point` and `precision`.
-- `address` and `exact_point` leave the API only through /v1/me/pickup-locations (R2.4).
create table public.pickup_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  address text not null,
  exact_point extensions.geography(Point, 4326) not null,
  public_point extensions.geography(Point, 4326) not null,
  precision text not null check (precision in ('1km', '5km')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pickup_locations_user_id_idx on public.pickup_locations (user_id);

-- R2.6: never deleted. R2.3: `public_point` is a copy of the pickup location's.
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id),
  pickup_location_id uuid references public.pickup_locations (id),
  category_id uuid references public.categories (id),
  title text not null check (char_length(title) between 1 and 100),
  description text not null default '' check (char_length(description) <= 5000),
  condition text check (condition in ('like_new', 'good', 'fair')),
  daily_price_cents integer check (daily_price_cents > 0),        -- R2.11
  deposit_cents integer not null default 0 check (deposit_cents >= 0),
  currency text not null default 'CAD' check (currency = 'CAD'),  -- G2.16
  public_point extensions.geography(Point, 4326),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  -- G2.15: keyword search for step 3.
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, title || ' ' || description)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- R2.3: a public point exists exactly when a pickup location is set.
  check ((pickup_location_id is null) = (public_point is null))
);
create index listings_owner_id_idx on public.listings (owner_id);
create index listings_pickup_location_id_idx on public.listings (pickup_location_id);

-- R2.17: a path is never reused; the API grants no update on it.
-- R2.16: `verified_at` is set by the photo job (G2.9).
create table public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id),
  storage_path text not null unique,
  position integer not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index listing_images_listing_id_idx on public.listing_images (listing_id);

-- Invariant 3: the exclusion constraint is the guarantee against double booking.
-- Step 5 adds the foreign key from `rental_item_id` to `rental_items(id)`.
create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id),
  period daterange not null,
  kind text not null check (kind in ('owner_block', 'rental')),
  rental_item_id uuid unique,
  check ((kind = 'rental') = (rental_item_id is not null)),
  exclude using gist (listing_id with =, period with &&)
);

-- G2.14: an avatar waits here until the photo job passes it.
alter table public.users add column avatar_pending_path text;

-- R1.8: row-level security on, no policies.
alter table public.categories enable row level security;
alter table public.pickup_locations enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.availability_blocks enable row level security;

grant select on public.categories to api;
grant select, insert, update on public.pickup_locations to api;
grant select, insert, update on public.listings to api;
grant select, insert, delete on public.listing_images to api;
grant update (verified_at) on public.listing_images to api;
grant select, insert, delete on public.availability_blocks to api;

-- G2.6: the bucket enforces JPEG only and 5 MB a file. The photo job checks again.
-- Both buckets are public: listing photos and avatars are shown to anyone.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('listing-photos', 'listing-photos', true, 5242880, array['image/jpeg']),
  ('avatars', 'avatars', true, 5242880, array['image/jpeg'])
on conflict (id) do nothing;
