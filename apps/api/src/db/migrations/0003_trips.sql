-- Step 4: trips and trip items. A trip reserves nothing (R4.2).
-- Runs as `postgres`, which owns every table (G1.3).

-- G4.2: `origin_point` is snapped to the 1 km grid by the API.
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  renter_id uuid not null references public.users (id),
  name text not null check (char_length(name) between 1 and 60),
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  origin_point extensions.geography(Point, 4326),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index trips_renter_id_idx on public.trips (renter_id, created_at desc, id desc);

-- R4.4: a listing once per trip. G4.1: the price to compare the live one with.
create table public.trip_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id),
  listing_id uuid not null references public.listings (id),
  start_date date not null,
  end_date date not null,
  daily_price_cents_at_add integer not null check (daily_price_cents_at_add > 0),
  created_at timestamptz not null default now(),
  unique (trip_id, listing_id),
  check (end_date >= start_date)
);

-- R1.8: row-level security on, no policies.
alter table public.trips enable row level security;
alter table public.trip_items enable row level security;

grant select, insert on public.trips to api;
grant update (status) on public.trips to api; -- `for update` on a trip needs an update grant
grant select, insert, delete on public.trip_items to api;
