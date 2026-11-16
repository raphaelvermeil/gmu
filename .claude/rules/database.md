---
paths:
  - "apps/api/src/db/**"
---

# Database rules

- A committed migration is never edited. A hook blocks the edit. Add a new file.
- A destructive change ships in two migrations: stop using the column, then drop it in a later release.
- Every new table has a UUID primary key and `enable row level security`, with no policies.
- Money columns are integer cents and end in `_cents`. The row carries a `currency`.
- Rental dates are `date` or `daterange`, never timestamps. A period is `[start, end + 1 day)`.
- Location columns are `geography(Point, 4326)`.
- Constraints live in SQL: exclusion, check, unique, foreign key. Write them by hand where Drizzle cannot express them.
- `rental_events` is append-only.
- Add the index a query needs in the same migration as the query's table or column.
