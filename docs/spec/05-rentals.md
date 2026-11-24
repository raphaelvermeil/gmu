# Step 5: Rentals

**Goal:** a renter sends every request in a trip with one tap. Each owner accepts or declines. A pending or confirmed rental blocks its dates, an unanswered request expires, and two people can never book the same item for the same day.

**Depends on:** step 4.

This is the highest-risk step. Plan it before writing code, and read the migrations and the transition function yourself.

## In scope

- `rentals`, `rental_items`, `rental_events`, and rental blocks in `availability_blocks`.
- Trip submit.
- The transition function and the accept, decline and cancel commands.
- Expiry: the job, and the sweeper that catches a lost job.
- The gated `pickup-details` route.
- Renter and owner rental lists and the rental screen.

## Out of scope

- Notifications, push, email, realtime events and system messages. Step 6 adds them inside the transition function.
- The scan that fires `pickup` and `return` (step 7). The two events are defined and tested here by calling the function directly.

## Data

| Table | Fields | Notes |
| --- | --- | --- |
| `rentals` | `trip_id`, `renter_id`, `owner_id`, `period`, `status`, `expires_at`, `pickup_location_id`, `quoted_total_cents`, `deposit_cents`, `currency`, `cancelled_by`, one timestamp per transition | Check: renter and owner differ |
| `rental_items` | `rental_id`, `listing_id`, `title_snapshot`, `daily_price_cents`, `days`, `line_total_cents` | Frozen at submit |
| `rental_events` | `rental_id`, `type`, `actor_id`, `from_status`, `to_status`, `data`, `created_at` | Append-only |

Also add the foreign key from `availability_blocks.rental_item_id` to `rental_items(id)` with `on delete cascade`.

## The transition table

This table is the whole state machine. Any pair of status and event that is not in it is refused.

| From | Event | Who | To |
| --- | --- | --- | --- |
| `requested` | `accept` | Owner | `confirmed` |
| `requested` | `decline` | Owner | `declined` |
| `requested` | `expire` | System | `expired` |
| `requested` | `cancel` | Renter | `cancelled` |
| `confirmed` | `cancel` | Renter, owner, or system (G5.5) | `cancelled` |
| `confirmed` | `pickup` | Renter, or system for a settled report | `active` |
| `active` | `return` | Owner, or system for a settled report | `completed` |

`completed`, `declined`, `expired` and `cancelled` are final.

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `POST /v1/trips/:id/submit` | One rental request per group (R4.6), with any conflicts named | The trip's renter |
| `GET /v1/rentals?role=...&status=...` | The caller's rentals as renter or as owner | Signed-in user |
| `GET /v1/rentals/:id` | One rental with its items and events | Participant |
| `POST /v1/rentals/:id/accept`, `/decline` | The owner's decision | Owner |
| `POST /v1/rentals/:id/cancel` | Cancellation | Renter or owner, per the table |
| `GET /v1/rentals/:id/pickup-details` | The exact address | Participant, while `confirmed` or `active` |

## Rules

Submit:

- **R5.1** Submit groups the trip's items by owner, date range and pickup location (R4.6). For each group, one transaction creates the rental in `requested`, its items with title and price snapshots, one availability block per item, the `requested` event and the expiry job.
- **R5.2** If a group's transaction hits the exclusion constraint, that whole group rolls back and the response names the conflicting listings. The other groups are not affected.
- **R5.3** The response is `{ created, conflicts }`. The status is 200 when at least one rental was created and 409 when none was.
- **R5.4** Submit skips an item that is already covered by a rental of this trip in `requested`, `confirmed`, `active` or `completed`. Submitting again after a decline therefore sends only what has not been sent. Repeating a submit creates nothing new.
- **R5.5** The renter's phone must be verified. Each listing must be active. The renter cannot be the owner.
- **R5.6** Caps are checked before anything is written: at most 10 rentals in `requested` per renter, and at most 3 new requests a day for an account younger than 7 days. A submit that would pass a cap is refused whole with the code `request_limit`.
- **R5.7** `quoted_total_cents` is the sum of days times daily price at submit. `deposit_cents` is the sum of the listings' deposits at submit. Later edits to a listing change nothing on the rental.
- **R5.8** The period is stored as `[start, end + 1 day)`. A rental that ends on the 5th and one that starts on the 5th conflict.

Transitions:

- **R5.9** `transitionRental(tx, rentalId, event, actor)` locks the rental row with `select ... for update`, checks status, event and actor against the table, then writes the status, the transition's timestamp and the `rental_events` row, all in the caller's transaction.
- **R5.10** No other code writes `rentals.status`.
- **R5.11** A pair that is not in the table returns 409 with the code `invalid_transition` and writes nothing. The right event from the wrong person returns 403.
- **R5.12** A command whose target status is already the current status returns success and writes no second event.
- **R5.13** `decline`, `expire` and `cancel` delete the rental's availability blocks in the same transaction.
- **R5.14** `decline` requires a reason. The owner answers for the whole rental.
- **R5.15** `cancel` records who cancelled in `cancelled_by`. There is no cancel once a rental is `active`.

Expiry:

- **R5.16** `expires_at` is set at submit. A job fires `expire` at that time.
- **R5.17** A sweeper runs every 5 minutes and fires `expire` for any `requested` rental past its `expires_at`. Both paths go through the transition function, so running twice is harmless.

Reading:

- **R5.18** `pickup-details` returns the address and exact point to a participant while the rental is `confirmed` or `active`. A non-participant gets 403. A participant in any other status gets 409.
- **R5.19** The rental list and rental detail return only rentals where the caller is the renter or the owner, and never contain an address.
- **R5.20** `rental_events` is append-only. An update or a delete from the API's database connection fails.
- **R5.21** Nothing in the database ties the outcomes of a trip's rentals together. "2 of 3 confirmed" is computed when the trip is read.
- **R5.22** Indexes: `rentals (renter_id, status)`, `rentals (owner_id, status)`, `rentals (expires_at)` where status is `requested`, `rental_events (rental_id, created_at)`.

## Tests to write first

- **Transition table.** For every combination of status, event and actor, call the function. An allowed one gives the new status and exactly one new event row. A refused one gives 409 or 403 and writes nothing. Generate the cases from the table so none is missed.
- **Repeat.** The same command twice: the second returns success and adds no event row.
- **Double booking.** Two renters submit overlapping dates for one listing at the same time, on two connections. Exactly one rental exists afterwards. The other response names the listing.
- **Touching dates.** One rental ends on 5 July. A request starting 6 July succeeds. A request starting 5 July conflicts.
- **Freed dates.** After a decline, an expiry and a cancel, the same dates can be booked again.
- **Race.** Accept and expire fired at the same time on one rental: one wins, the other is refused or is a no-op, and the status, blocks and events agree with each other.
- **Partial submit.** A trip with owners X and Y, where Y's item was taken: X's rental exists, Y's is named as a conflict, and no rental, item or block for Y was left behind.
- **Snapshot.** Changing a listing's price or title after submit leaves the rental's items unchanged.
- **Caps.** The 11th open request is refused. The 4th request in a day from a 3-day-old account is refused.
- **Authorization.** A third user gets 403 on accept, decline, cancel, rental detail and `pickup-details`. A renter gets 403 on accept and decline.
- **Address gate.** `pickup-details` returns 409 in `requested`, `declined`, `expired`, `cancelled` and `completed`, and 200 in `confirmed` and `active`.
- **Append-only.** An update and a delete on `rental_events` both fail.
- **Archive.** Archiving a listing with a rental in `requested`, `confirmed` or `active` returns 409 (rule R2.8).
- **Sweeper.** With the expiry job removed, the sweeper still expires the rental.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] You have read the migrations, `state-machine.ts` and the submit transaction line by line.
- [ ] Two phones: one sends a request, the other accepts, and the address appears for the renter only after that.

## Gaps filled

- **G5.1 "Expires sooner when pickup is close."** The proposal gives no number. Default: `expires_at` is the earlier of 24 hours after submit and midnight at the start of the pickup day. A request whose first day is today is refused, so the earliest start date is tomorrow.
- **G5.2 Withdrawing a request.** The proposal mentions withdrawing but names no state for it. Default: the renter's `cancel` on a `requested` rental, ending in `cancelled`.
- **G5.3 Passing a cap.** Default: the whole submit is refused (R5.6), not sent in part.
- **G5.4 Status code of a partial submit.** The proposal says both "the other requests still go out" and "a booking conflict is a 409". R5.3 is how this spec reconciles them.
- **G5.5 A confirmed rental that is never picked up.** The proposal flags it as a no-show but leaves it `confirmed` forever, which would block archiving the listing. Default: the sweeper fires `cancel` as the system the day after the rental's last day.
- **G5.6 Time zone.** Dates are calendar dates at the pickup location. Default: one constant, `America/Toronto`, in `packages/shared`.
- **G5.7 Where the decline reason is stored.** Default: in the event's `data`.
- **G5.8 Route.** `GET /v1/rentals/:id` is not in the proposal's endpoint table.
- **G5.9 Carried over from step 4.** The blocks of a trip's own rentals must not mark that trip's items `unavailable`. The foreign key on `rental_item_id` breaks the step 3 and step 4 tests that insert a `rental` block with a made-up id; change their setup. Nothing yet says when a trip becomes `submitted`: ask.
