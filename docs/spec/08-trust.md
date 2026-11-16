# Step 8: Trust

**Goal:** after a rental, both people can review each other. Anyone can report a user to the operator and block a user.

**Depends on:** step 7.

## In scope

- Reviews, published double-blind.
- Reports that reach the operator.
- Blocking.
- Public profiles with ratings.

## Out of scope

- An admin screen, admin routes or an admin role. The operator works in the Supabase dashboard.
- Arbitration, claims or anything about money.
- Identity document checks.

## Data

| Table | Fields | Notes |
| --- | --- | --- |
| `reviews` | `rental_id`, `author_id`, `subject_id`, `role`, `rating`, `body`, `published_at` | Unique on `(rental_id, author_id)` |
| `reports` | `reporter_id`, `reported_user_id`, `rental_id`, `reason`, `note`, `status` | `status` is `open` or `closed` |
| `user_blocks` | `blocker_id`, `blocked_id`, `created_at` | Unique on the pair; see G8.1 |

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `POST /v1/rentals/:id/reviews` | Leave a review | Participant of a completed rental |
| `GET /v1/users/:id` | Public profile: display name, avatar, ratings | Anyone |
| `GET /v1/users/:id/reviews` | Published reviews about a user | Anyone |
| `POST /v1/reports` | Report a user | Signed-in user |
| `POST`, `DELETE /v1/users/:id/block` | Block and unblock | Signed-in user |

## Rules

Reviews:

- **R8.1** A review can be left only on a `completed` rental, by its renter or its owner, once each.
- **R8.2** `rating` is a whole number from 1 to 5. `body` is optional.
- **R8.3** A review is visible only to its author until it is published. It is published when both reviews exist, or 14 days after the rental completed, whichever comes first. A job handles the 14-day case.
- **R8.4** A review cannot be edited or deleted by its author.
- **R8.5** Publishing a review updates the subject's rating average and count in the same transaction.
- **R8.6** The public profile and review list contain no email, phone number, address or location.

Reports:

- **R8.7** Any signed-in user can report another user. A report may name a rental only if the reporter takes part in it.
- **R8.8** `reason` comes from a fixed list. `note` is free text.
- **R8.9** A new report emails the operator with ids only. The reported user is not told.
- **R8.10** There are no routes for handling reports. The operator reads and closes them in the Supabase dashboard.
- **R8.11** After a return scan the owner is asked "All good" or "There is a problem". The second opens the report form with the rental filled in and room for photos and a note. The rental is already `completed` either way.

Blocking:

- **R8.12** When one user blocks another, neither can send the other a message or a rental request, and neither sees the other's listings in search. The refusal uses the code `blocked`.
- **R8.13** A block does not change a rental that already exists. The two can still complete it and message about it.
- **R8.14** The blocked user is not told.

## Tests to write first

- A review on a rental that is not `completed` returns 409. A third user gets 403. A second review by the same author is refused.
- Double-blind: after one review, the other party and the public cannot read it. After both, both are public. After 14 days with one review, the job publishes it.
- Publishing updates the average and the count correctly for a known set of ratings.
- A report that names a rental the reporter does not take part in is refused.
- A new report queues one email to the operator, and the email holds no address.
- After a block: a message between the two is refused in both directions, a trip submit between the two is refused, and search hides the listings both ways.
- A block leaves a `confirmed` rental between the two usable through pickup and return.
- The profile and review routes return no email, phone number, address or coordinate.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] `docs/runbook-moderation.md` exists and you have followed it once on staging (see G8.3).

## Gaps filled

- **G8.1 Where blocks are stored.** The build order includes blocking, but the proposal's schema has no table for it. Default: `user_blocks`.
- **G8.2 Report reasons.** Default: `no_show`, `damaged_gear`, `deposit_not_returned`, `late_return`, `abuse`, `other`.
- **G8.3 How the operator removes a user.** The proposal says you can warn or remove users but not how. Default: a written runbook with the steps in the Supabase dashboard and the SQL to pause the user's listings and cancel their open requests. I have not verified what a ban in Supabase Auth does to a session that is already open.
- **G8.4 Review window.** Default: reviews can be left until 14 days after completion.
- **G8.5 A block during an open conversation about an existing rental.** R8.13 is my reading. The proposal only says "report and block".
- **G8.6 Routes.** The profile, review list and block routes are not in the proposal's endpoint table.
