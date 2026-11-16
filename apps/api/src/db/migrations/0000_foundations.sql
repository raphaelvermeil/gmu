-- Step 1: extensions, the API's database role, and the users table.
-- Runs as `postgres`, which owns every table (G1.3).

-- Extensions live in `extensions` so `public` holds app tables only.
create extension if not exists postgis with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- The API connects as `api`. It bypasses row-level security, owns nothing and
-- gets explicit grants per table. Its password is set outside migrations.
do $$
begin
  if not exists (select from pg_roles where rolname = 'api') then
    create role api nologin bypassrls;
  end if;
end
$$;
grant usage on schema public to api;
grant usage on schema extensions to api;

create table public.users (
  id uuid primary key, -- equal to the Supabase auth user id (R1.4)
  display_name text,
  avatar_path text,
  phone_verified_at timestamptz,
  owner_rating_avg numeric(3, 2),
  owner_rating_count integer not null default 0,
  renter_rating_avg numeric(3, 2),
  renter_rating_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- R1.8: row-level security on, no policies.
alter table public.users enable row level security;

grant select, insert, update on public.users to api;
