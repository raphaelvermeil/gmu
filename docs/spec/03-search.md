# Step 3: Search

**Goal:** a renter sees gear near a point that is free on their dates, nearest first, and can open a listing page that also works as a shared link on the web.

**Depends on:** step 2.

## In scope

- The search query and its endpoint.
- Public listing detail with HTTP caching.
- A separate availability call for one listing.
- Search and listing screens: a distance-sorted list with date and category filters, and infinite scroll.
- Server-rendered listing pages on web.

## Out of scope

- A map view.
- A search engine, a read replica, a server-side cache.
- Rate limits (step 9).

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `GET /v1/listings?lat&lng&radius_km&from&to&category&q&cursor` | Nearby gear that is free on the dates | Anyone |
| `GET /v1/listings/:id` | Listing detail, from step 2, now with cache headers | Anyone |
| `GET /v1/listings/:id/availability?from&to` | The date ranges on which the listing is taken | Anyone |

The query has this shape. Keep it as hand-written SQL.

```sql
select l.id, l.title, l.daily_price_cents,
       st_distance(l.public_point, :origin) as distance_m
from listings l
where l.status = 'active'
  and st_dwithin(l.public_point, :origin, :radius_m)
  and (:category::uuid is null or l.category_id = :category)
  and not exists (
    select 1 from availability_blocks b
    where b.listing_id = l.id and b.period && :period)
order by l.public_point <-> :origin
limit 30;
```

## Rules

- **R3.1** Only `active` listings appear.
- **R3.2** The filter, the ordering and the distance shown all come from `public_point`. `exact_point` appears in no query in this module.
- **R3.3** `from` and `to` are inclusive calendar dates. A listing matches when no availability block overlaps `[from, to + 1 day)`. A rental that ends on the 5th therefore blocks a search that starts on the 5th.
- **R3.4** The server caps `radius_km`.
- **R3.5** `category` matches the category and its children.
- **R3.6** `q` searches the listing's full-text search vector, built from title and description.
- **R3.7** Results come 30 to a page, nearest first, with a `(distance, id)` cursor.
- **R3.8** Each result is built from an output schema: id, title, daily price, deposit, currency, first verified photo, distance, category, and the owner's display name and rating.
- **R3.9** Search results are not cached on the server. Listing detail is sent with a public cache lifetime of 60 seconds and stale-while-revalidate. The category tree is sent with a lifetime of one hour. Availability is never cached.
- **R3.10** The availability route returns date ranges only. It does not say who rented or why a range is blocked.
- **R3.11** On web, a listing page renders on the server with title, description and image meta tags. If server rendering misbehaves, say so and switch `web.output` to `static`. Do not build a workaround.
- **R3.12** The `search` module may read other modules' tables. It writes nothing.
- **R3.13** Indexes: GiST on `listings.public_point` where status is active; GIN on the search vector; btree on `category_id` and on `owner_id`.

## Tests to write first

- A listing just outside the radius, measured from its public point, is not returned. One just inside is.
- The distance returned equals the distance from the origin to the public point. Set up a location whose exact and public points differ, search from the exact point's coordinates, and expect a distance above zero.
- Two listings at the same address return identical coordinates and distances.
- A listing with a block that overlaps the dates is excluded. A listing whose block ends the day before `from` is included. A listing whose block ends on `from` is excluded.
- Results are ordered nearest first. Paging through all results gives no duplicate and no gap, including when several listings share one distance.
- The category filter returns listings in child categories.
- Privacy: the search and detail responses contain no `address` key, no `exact_point` key and no coordinate equal to an exact point.
- Draft, paused and archived listings never appear.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] With 10,000 seeded listings, `explain analyze` on a typical search shows the GiST index in use. Paste the plan.
- [ ] A listing link pasted into a chat app shows a preview with title and photo.

## Gaps filled

- **G3.1 Radius.** Default 25 km when omitted, 100 km at most. The proposal says "a capped radius" without numbers.
- **G3.2 Text search language.** Listings in Montreal will be in French and English. Default: the `simple` configuration with `unaccent`. I have not tested which configuration ranks better.
- **G3.3 Filtering by size attributes.** The proposal says search can filter on them but its endpoint has no parameter for it. Default: `attr[key]=value`, exact match.
- **G3.4 Dates.** Default: `from` and `to` are optional and come together; `from` is tomorrow or later (see G5.1); the range is 30 days at most.
- **G3.5 Where the search starts from.** `lat` and `lng` come from the client. Whether that is the device's location or a typed place depends on G2.1.
- **G3.6 Route.** The availability route is not in the proposal's endpoint table. The proposal only says availability is fetched separately.
