# Step 7: Handover

**Goal:** pickup and return are confirmed by a scan between the two phones, with photos and the money confirmations on record. When one person cannot or will not scan, the other can still close the handover.

**Depends on:** step 6.

Plan this step before writing code. It needs testing on two real phones.

## In scope

- Handover tokens, the QR code and the 6-digit fallback.
- The scan that fires `pickup` and `return`.
- Handover photos in the private bucket.
- "Payment received", "deposit received", "deposit returned" and "deposit kept" confirmations.
- One-sided handover reports with a 24-hour contest window.
- The hourly no-show and overdue check.

## Out of scope

- Scanning in the browser. Web shows a code and accepts the 6-digit code.
- Judging the condition of the gear. That is a report in step 8.
- Anything that moves money.

## Data

| Table | Fields | Notes |
| --- | --- | --- |
| `handover_tokens` | `rental_id`, `kind`, `token_hash`, `code_hash`, `issued_by`, `expires_at`, `used_at` | `kind` is `pickup` or `return`; single use |
| `handover_photos` | `rental_id`, `kind`, `uploader_id`, `storage_path`, `sha256`, `created_at` | Private bucket |

The confirmations and the one-sided reports are rows in `rental_events`.

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `POST /v1/rentals/:id/handover-tokens` | Issue a token and code, with the money confirmations | Owner for pickup, renter for return |
| `POST /v1/handovers/scan` | Redeem a token or a code | The other person |
| `POST /v1/rentals/:id/handover-photos` | A signed upload URL for a photo | Participant |
| `POST /v1/rentals/:id/handover-reports` | State that a handover happened, with photos | Participant |
| `POST /v1/rentals/:id/handover-reports/contest` | Dispute the other person's report | The other participant |

## Rules

Who does what:

- **R7.1** The owner issues the pickup token and the renter scans it. The renter issues the return token and the owner scans it. The person who would lose from a false confirmation is the one who scans.
- **R7.2** A pickup token is issued only to the owner of a `confirmed` rental, and only when the request confirms `payment_received`, and `deposit_received` if the rental has a deposit. The confirmations are written to `rental_events`.
- **R7.3** A return token is issued only to the renter of an `active` rental, and only when the request states `deposit_returned` or `deposit_kept` if the rental has a deposit. The statement is written to `rental_events`.

Tokens:

- **R7.4** A token is 128 random bits from the system's secure random source. Only its hash is stored. It expires after 60 seconds and works once.
- **R7.5** Each token comes with a 6-digit code, stored hashed, with the same expiry.
- **R7.6** Issuing a new token cancels any unused token of the same kind for that rental.
- **R7.7** The app redraws the QR every 45 seconds. The QR holds a link that opens the app.
- **R7.8** Tokens and codes are never logged.

The scan:

- **R7.9** A scan is accepted only when all of these hold: the token or code matches one that is unexpired and unused; the caller is the rental's renter for a pickup or its owner for a return; the rental is `confirmed` for a pickup or `active` for a return; and for a pickup, today is inside the rental period or the day before it.
- **R7.10** An accepted scan is one transaction: mark the token used, fire `pickup` or `return` through `transitionRental`, and record the event.
- **R7.11** A pickup scan is refused until the renter has uploaded at least one pickup photo per rental item.
- **R7.12** The code path takes `{ rental_id, code }` and follows the same rules. It allows 5 attempts per rental in any 10 minutes, counted in the database. Further attempts return 429.
- **R7.13** A return scan completes the rental whatever the state of the gear. A return is never blocked by a disagreement.

Photos:

- **R7.14** Photos are taken with the in-app camera and uploaded to the private bucket through a signed URL limited by type and size. The `sha256` is recorded at upload.
- **R7.15** Only the rental's two participants can get a link to a handover photo, and the link is short-lived.

One person alone:

- **R7.16** A participant can report that a pickup or a return happened, with at least one photo and a note. The other person is notified and has 24 hours to contest.
- **R7.17** If the report is not contested, a job fires `pickup` or `return` as the system after 24 hours. The sweeper from step 5 also settles a report whose job was lost.
- **R7.18** If it is contested, nothing transitions and a report is opened for the operator.

Checks:

- **R7.19** An hourly job flags a no-show (a `confirmed` rental whose first day has passed with no pickup) and an overdue return (an `active` rental whose last day has passed). Each flag is written once per rental, notifies both people and emails the operator.
- **R7.20** Scanning is native only, behind `scanner.native.tsx` and `scanner.web.tsx`.

## Tests to write first

- An expired token is refused. A used token is refused.
- A third user scanning a valid token gets 403. The issuer scanning their own token is refused.
- A pickup scan on a rental that is not `confirmed`, and a return scan on one that is not `active`, return 409.
- A pickup scan two days before the first day is refused. One on the day before is accepted.
- Two scans of one token at the same time produce exactly one transition and one event.
- The database holds no raw token and no raw code after issuing.
- Issuing without the required confirmations is refused. With them, the matching `rental_events` rows exist.
- A pickup scan with fewer photos than items is refused.
- The sixth code attempt within 10 minutes returns 429, including when the sixth code is correct.
- An uncontested report fires the transition when its job runs. A contested one does not, and a report for the operator exists.
- A third user cannot get a link to a handover photo.
- The hourly check writes one flag per rental however many times it runs.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] Two phones, in person: a full pickup and return by QR, then again with the 6-digit code and the camera covered.
- [ ] A screenshot of the QR, scanned after 60 seconds and scanned by a third account, is refused both times.
- [ ] A pickup started in the web app shows the code and accepts the typed code.

## Gaps filled

- **G7.1 Where a one-sided report is stored.** The proposal has no table for it. Default: `rental_events` rows of type `handover_reported` and `handover_contested`, plus the 24-hour job. No new table.
- **G7.2 "One photo per item."** `handover_photos` has no link to an item. Default: the count of the renter's pickup photos must be at least the number of items.
- **G7.3 Photos at return.** Default: optional for the owner.
- **G7.4 After a contest.** The proposal does not say. Default: the rental stays in its current status and the operator settles it by hand.
- **G7.5 Early return.** Default: the remaining days stay blocked.
- **G7.6 "Today".** Default: the date in `America/Toronto` (see G5.6).
- **G7.7 The event names** `payment_received`, `deposit_received`, `deposit_returned`, `deposit_kept`, `flagged_no_show` and `flagged_overdue` are my choice.
- **G7.8 Routes.** The photo upload route and the contest route are not in the proposal's endpoint table.
