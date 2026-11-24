# Step 3: Search

**Goal:** a renter sees gear near a point that is free on their dates, nearest first, and can open a listing page that also works as a shared link on the web.

**Depends on:** step 2.

## In scope

- The search query and its endpoint.
- Public listing detail with HTTP caching.
- A separate availability call for one listing.
- Search and listing screens: a list sorted nearest first or cheapest first, with a keyword box, a date filter picked on a small calendar, a category filter, and infinite scroll.
- Server-rendered listing pages on web.

## Out of scope

- A map view.
- A search engine, a read replica, a server-side cache.
- Rate limits (step 9).

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `GET /v1/listings?lat&lng&radius_km&from&to&category&q&sort&cursor&limit` | Nearby gear that is free on the dates | Anyone |
| `GET /v1/listings/:id` | Listing detail, from step 2, now with cache headers | Anyone |
| `GET /v1/listings/:id/availability?from&to` | The date ranges on which the listing is taken | Anyone |

The query has this shape. Keep it as hand-written SQL. The sketch leaves out `q`, the sort and the cursor; R3.6 and R3.7 add them.

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
order by distance_m, l.id
limit 30;
```

## Rules

- **R3.1** Only `active` listings appear.
- **R3.2** The filter, the ordering and the distance shown all come from `public_point`. `exact_point` appears in no query in this module.
- **R3.3** `from` and `to` are inclusive calendar dates. A listing matches when no availability block overlaps `[from, to + 1 day)`. A rental that ends on the 5th therefore blocks a search that starts on the 5th.
- **R3.4** The server caps `radius_km`: a value above the maximum is lowered to it. Zero or a negative value returns 400.
- **R3.5** `category` matches one category. Categories have one level (G2.2).
- **R3.6** `q` searches the listing's full-text search vector, built from title and description. It ignores accents and matches the start of words. Every word in `q` must match. `q` only filters; it does not change the order.
- **R3.7** Results come 30 to a page; `limit` can lower that, never raise it. `sort=distance` (the default) orders nearest first with a `(distance, id)` cursor. `sort=price` orders by daily price, cheapest first, with a `(daily_price_cents, id)` cursor. Both keep the radius filter. The order uses the same distance value as the cursor.
- **R3.8** Each result is built from an output schema: id, title, daily price, deposit, currency, first verified photo, distance, category, and the owner's display name and rating.
- **R3.9** Search results are not cached on the server. Listing detail, when the request has no token and the listing is active, is sent with `public, max-age=60, stale-while-revalidate=60`. With a token it is sent with `private, no-store`, because the owner also sees drafts and unverified photos. Both carry `Vary: Authorization`. Errors are not cached. The category list is sent with a lifetime of one hour. Availability is never cached.
- **R3.10** The availability route returns date ranges only. It does not say who rented or why a range is blocked. Ranges that touch or overlap are merged, and the dates are inclusive.
- **R3.11** On web, a listing page renders on the server with title, description and image meta tags. If server rendering misbehaves, stop and ask the owner. Do not build a workaround, and do not switch `web.output` to `static` without an answer: a static build cannot show link previews.
- **R3.12** The `search` module may read other modules' tables. It writes nothing.
- **R3.13** Indexes: GiST on `listings.public_point` where status is active; GIN on the search vector; btree on `category_id` and on `owner_id`.

## Tests to write first

- A listing just outside the radius, measured from its public point, is not returned. One just inside is.
- The distance returned equals the distance from the origin to the public point. Set up a location whose exact and public points differ, search from the exact point's coordinates, and expect a distance above zero.
- Two listings at the same address return identical coordinates on listing detail and identical distances in search.
- A listing with a block that overlaps the dates is excluded. A listing whose block ends the day before `from` is included. A listing whose block ends on `from` is excluded.
- Results are ordered nearest first. Paging through all results gives no duplicate and no gap, including when several listings share one distance.
- The category filter returns only listings in that category.
- `sort=price` returns cheapest first. Paging through it gives no duplicate and no gap, including when several listings share one price.
- Privacy: the search and detail responses contain no `address` key, no `exact_point` key and no coordinate equal to an exact point.
- Draft, paused and archived listings never appear.
- `q` ignores accents in both directions, matches the start of a word, requires every word, and survives punctuation.
- A radius above the maximum is lowered to it. Zero and negative values return 400.
- `from` without `to`, `from` before tomorrow in Toronto, and a range of 31 counted days return 400. A range of 30 counted days is accepted.
- Availability merges ranges that touch or overlap, returns dates only, returns 400 for a window over 366 days, and returns 404 for a listing that is not active.
- Cache headers match R3.9 with a token, without one, and on an error.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] With 10,000 seeded listings, `explain analyze` on a typical search shows the GiST index in use. Paste the plan.
- [ ] A listing link pasted into a chat app shows a preview with title and photo.

## Gaps filled

- **G3.1 Radius.** Default 25 km when omitted, 100 km at most (a larger value is lowered, R3.4). The proposal says "a capped radius" without numbers.
- **G3.2 Text search language.** Listings in Montreal will be in French and English. The `simple` configuration with `unaccent`, decided on 23 November 2026. A step 3 migration adds the extension and an immutable wrapper function, and rebuilds `search_vector` (G2.15).
- **G3.3 Filtering by size attributes.** None. Listings have no attributes (G2.2); keyword search covers the description.
- **G3.4 Dates.** Default: `from` and `to` are optional and come together; `from` is tomorrow or later in `America/Toronto` (see G5.1); the range is 30 days at most, counting both ends. Without dates, the availability filter is skipped.
- **G3.5 Where the search starts from.** `lat` and `lng` come from the client. The app sends the device's location (G2.1). When the renter denies it, the search screen shows a message and no results.
- **G3.6 Route.** The availability route is not in the proposal's endpoint table. The proposal only says availability is fetched separately. `from` and `to` are required, inclusive, at most 366 days counting both ends, and may be in the past. A listing that is not active returns 404.
- **G3.7 Search filters**, chosen by the owner on 17 November 2026: keyword (`q`, title and description), dates on a small calendar, category, and a sort by price. There is no price range filter.
- **G3.8 The calendar.** `react-native-ui-datepicker` 3.3.0, approved on 23 November 2026. Check it on web, server rendering included, before building screens on it. If it fails, stop and ask.
- **G3.9 Routes in the app.** `/listings/:id` is the public listing page. The owner's edit screen moves to `/listings/:id/edit`. Search and the public page work without signing in.
- **G3.10 Result fields.** Search results carry no coordinates. Distance is in whole metres. `category` in a result is id, slug and label. The rating is the owner's average and count as owner, empty until step 8. The first photo is the verified one with the lowest `position`. Owners see their own listings.
- **G3.11 Query parameters.** `category` is the category's id. A cursor is valid only with the sort that made it; otherwise 400.
