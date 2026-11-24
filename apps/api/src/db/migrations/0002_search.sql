-- Step 3: accent-insensitive keyword search and the search indexes.
-- Runs as `postgres`, which owns every table (G1.3).

create extension if not exists unaccent with schema extensions;

-- G3.2: plain words, no accents, no punctuation. The search vector and `q` both go through it.
-- `unaccent` itself is only stable; naming the dictionary makes it safe to declare immutable.
create function public.search_text(value text) returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select regexp_replace(
    extensions.unaccent('extensions.unaccent'::regdictionary, value), '[^[:alnum:]]+', ' ', 'g')
$$;
revoke execute on function public.search_text(text) from public, anon, authenticated;
grant execute on function public.search_text(text) to api;

-- G2.15 rebuilt: a generated column's expression cannot be changed in place.
alter table public.listings drop column search_vector;
alter table public.listings add column search_vector tsvector generated always as (
  to_tsvector('simple'::regconfig, public.search_text(title || ' ' || description))
) stored;

-- R3.13. `owner_id` is indexed in 0001.
create index listings_public_point_idx on public.listings using gist (public_point)
  where status = 'active';
create index listings_search_vector_idx on public.listings using gin (search_vector);
create index listings_category_id_idx on public.listings (category_id);
