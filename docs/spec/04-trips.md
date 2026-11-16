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
| `trips` | `renter_id`, `name`, `start_date`, `end_date`, `status` | `status` is `draft` or `submitted` |
| `trip_items` | `trip_id`, `listing_id`, `start_date`, `end_date` | Unique on `(trip_id, listing_id)` |

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
- **R4.6** `GET /v1/trips/:id` groups items by owner and date range. Each group is one future rental. The same owner with different dates gives separate groups.
- **R4.7** Each item is marked `available`, `unavailable` or `price_changed`. The mark is computed when the trip is read, from the live listing and its blocks. It is not stored.
- **R4.8** A listing that is paused or archived shows as `unavailable`. The item stays in the trip until the renter removes it.
- **R4.9** Each group shows the owner's display name and rating, the dates, the number of days, the estimated price and the deposit asked. The trip shows both totals. Nothing is charged.
- **R4.10** Days are counted inclusively: 3 to 5 July is 3 days. The estimated price of an item is days times the daily price.
- **R4.11** No trip response contains an address or an exact point.

## Tests to write first

- A second user gets 403 on read, add and remove.
- Adding an item creates no row in `availability_blocks`.
- Adding the same listing twice leaves one item.
- Adding your own listing, a draft listing or an archived listing is refused.
- Grouping: two items from one owner with the same dates form one group. Two items from one owner with different dates form two groups.
- Marks: an item becomes `unavailable` when another rental or a blackout takes its dates, and when its listing is paused. It becomes `price_changed` when the daily price changes after it was added.
- Totals: a known set of items gives the expected price and deposit per group and for the trip.
- Privacy: the trip response contains no `address` key and no `exact_point` key.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] You have built a trip with items from two owners on a phone and seen the two groups.

## Gaps filled

- **G4.1 `price_changed` needs a reference price.** The proposal's `trip_items` stores no price. Default: add `daily_price_cents_at_add` and compare it with the live price.
- **G4.2 The trip's starting point.** The proposal's flow has one, but its `trips` table does not. Default: an `origin_point` column, visible to the renter only, used to prefill searches from the trip. This depends on G2.1.
- **G4.3 The "area" shown for each owner.** The proposal shows an area on the trip screen but does not say where the name comes from. Default: show the distance from the trip's starting point and no place name.
- **G4.4 Deposit per group.** Default: the sum of the deposits of the group's listings.
- **G4.5 Route.** `GET /v1/trips` is not in the proposal's endpoint table.
