# Step 4: Trips

**Goal:** a renter collects gear from several owners into a trip and sees, owner by owner, what it would cost and whether it is still free. Nothing is reserved and no owner hears about it.

**Depends on:** step 3.

## In scope

- Trips and trip items.
- The trip screen: items grouped by owner, with live availability and price.

## Out of scope

- Submitting the trip (step 5).
- Trip templates and packing lists.

## Data

| Table | Fields | Notes |
| --- | --- | --- |
| `trips` | `renter_id`, `name`, `start_date`, `end_date`, `status`, `origin_point` | `status` is `draft` or `submitted`; `origin_point` is optional and snapped (G4.2) |
| `trip_items` | `trip_id`, `listing_id`, `start_date`, `end_date`, `daily_price_cents_at_add` | Unique on `(trip_id, listing_id)` |

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `POST /v1/trips` | Create a trip | Signed-in user |
| `GET /v1/trips` | The caller's trips | Signed-in user |
| `GET /v1/trips/:id` | The trip, grouped by owner, with live price and availability | The trip's renter |
| `POST /v1/trips/:id/items` | Add a listing with dates | The trip's renter |
| `DELETE /v1/trips/:id/items/:itemId` | Remove an item | The trip's renter |

## Rules

- **R4.1** A trip belongs to one renter. Anyone else gets 403 on every trip route.
- **R4.2** Adding an item stores the listing and the dates. It writes no availability block and notifies no one.
- **R4.3** An item's dates default to the trip's dates and may differ from them.
- **R4.4** A listing appears once in a trip. Adding it again returns the existing item.
- **R4.5** Only an active listing can be added. A renter cannot add their own listing.
- **R4.6** `GET /v1/trips/:id` groups items by owner, date range and pickup location. Each group is one future rental, with one pickup. The same owner with different dates or pickup locations gives separate groups.
- **R4.7** Each item is marked `available`, `unavailable` or `price_changed`. The mark is computed when the trip is read, from the live listing and its blocks. It is not stored.
- **R4.8** A listing that is paused or archived shows as `unavailable`. The item stays in the trip until the renter removes it.
- **R4.9** Each group shows the owner's display name and rating, the dates, the number of days, the estimated price and the deposit asked. The trip shows both totals. All totals leave out `unavailable` items and use the live price. Nothing is charged.
- **R4.10** Days are counted inclusively: 3 to 5 July is 3 days. The estimated price of an item is days times the daily price.
- **R4.11** No trip response contains an address or an exact point. The trip's own `origin_point` is snapped to 1 km.

## Tests to write first

- A second user gets 403 on read, add and remove.
- Adding an item creates no row in `availability_blocks`.
- Adding the same listing twice leaves one item.
- Adding your own listing, a draft listing or an archived listing is refused.
- Grouping: two items from one owner with the same dates form one group. Two items from one owner with different dates form two groups.
- Marks: an item becomes `unavailable` when another rental or a blackout takes its dates, and when its listing is paused. It becomes `price_changed` when the daily price changes after it was added.
- Totals: a known set of items gives the expected price and deposit per group and for the trip.
- Privacy: the trip response contains no `address` key and no `exact_point` key.
- Grouping: two items from one owner with the same dates and different pickup locations form two groups.
- The starting point is stored snapped. A trip without one has null distances.
- A trip or item that starts today or earlier, ends before it starts, or runs over 30 counted days returns 400. Item dates outside the trip's dates are accepted. Adding with the default dates of a trip that has started returns 400.
- An item whose start is today or earlier is `unavailable`.
- Totals leave out an unavailable item, including a paused one with no price.
- The 51st item returns 409 `trip_full`. Adding an item again in a full trip returns the existing item.
- Removing an item twice returns 204. An item of another trip is not removed.
- An unknown trip returns 404. Someone else's non-active listing returns 404. Your own returns 403 `own_listing`.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] You have built a trip with items from two owners on a phone and seen the two groups.

## Gaps filled

- **G4.1 `price_changed` needs a reference price.** The proposal's `trip_items` stores no price. Default: add `daily_price_cents_at_add` and compare it with the live price.
- **G4.2 The trip's starting point.** The proposal's flow has one, but its `trips` table does not. Decided on 24 November 2026: an optional `origin_point` column from the device's location (G2.1), snapped to the 1 km grid, visible to the renter only, used to prefill searches from the trip.
- **G4.3 The "area" shown for each owner.** The proposal shows an area on the trip screen but does not say where the name comes from. Default: show the distance from the trip's starting point to the group's public point, and no place name. Null without a starting point.
- **G4.4 Deposit per group.** Default: the sum of the deposits of the group's listings.
- **G4.5 Route.** `GET /v1/trips` is not in the proposal's endpoint table. It is paged, newest first, without items.

Decided by the owner on 24 November 2026:

- **G4.6 Dates.** Trip and item dates follow search (G3.4): the start is tomorrow or later in `America/Toronto`, 30 days at most counting both ends. Item dates may fall outside the trip's. An item whose start is today or earlier shows as `unavailable`.
- **G4.7 Editing.** None. To change an item's dates, remove it and add it again. A trip cannot be edited or deleted.
- **G4.8 Adding.** 201 for a new item. Adding a listing again returns the existing item unchanged with 200, even if the listing is no longer active or the trip is full. At most 50 items; the next returns 409 `trip_full`. Taken dates do not prevent adding.
- **G4.9 Refusals.** An unknown trip returns 404, another renter's 403. Someone else's non-active listing returns 404 (as G2.16); the caller's own returns 403 `own_listing`. Removing an item that is not in the trip returns 204.
- **G4.10 Marks.** `unavailable` wins over `price_changed`. A price drop also counts as a change.
- **G4.11 Names.** A trip's name is 1 to 60 characters. Its dates are required.
- **G4.12 Status.** Step 4 never refuses a change because of `status`: R5.4 allows submitting again.
- **G4.13 App flow.** "Find gear" on a trip opens search with the trip's dates and starting point. "Add to trip" on a listing page preselects that trip or asks which one, with dates that can be edited before adding.
- **G4.14 Data access.** `trips` calls service functions in `listings` and `identity`. It does not read their tables.
- **G4.15 Owner rules.** The proposal shows an owner's rules on each card. No field holds them, so they are left out.
