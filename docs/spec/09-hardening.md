# Step 9: Hardening

**Goal:** the product is safe to put in front of strangers and ready for store review.

**Depends on:** steps 1 to 8.

## You do by hand

- Have a lawyer review the terms of use and the privacy policy.
- Rehearse a restore from a Supabase backup into a scratch project.
- Set the sign-in rate limits in Supabase Auth. Sign-in does not pass through the API.
- Run Supabase's security advisor on staging and production.
- Store listings, screenshots and the submissions themselves.
- Test on real phones: push, camera, deep links, and a full rental between two people.

## In scope

- Authorization and location-privacy sweeps across every route.
- Rate limits inside the API process.
- In-app account deletion.
- Sentry in the app and the API, and alerts.
- Terms and privacy screens, with acceptance at sign-up.

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `DELETE /v1/me` | Delete the caller's account | Signed-in user |

## Rules

Sweeps:

- **R9.1** One test lists every route registered in the Hono app and calls each with no token and as a signed-in user who takes no part in the resource. Every route that is not marked open to anyone must return 401 without a token and 403 for the outsider. A route with no fixture fails the test, so a new route cannot be forgotten.
- **R9.2** One test collects the responses of every route for a seeded data set and searches them for an `address` key, an `exact_point` key and the seeded exact coordinates. Only the two routes named in invariant 2 may contain them.
- **R9.3** One test scans the captured log output of the full test run for the seeded address, a token, a handover code and a message body. None may appear.

Rate limits:

- **R9.4** Per-user and per-IP limits, held in the API process's memory, cover search, sending messages, issuing handover tokens and scans. Passing a limit returns 429.
- **R9.5** The business caps from steps 5 and 7 stay in SQL. They are not replaced by the in-memory limits.

Account deletion:

- **R9.6** Deletion is refused with 409 while the user has a rental in `requested`, `confirmed` or `active`, as renter or as owner.
- **R9.7** Deletion archives the user's listings, removes their push tokens, and removes or blanks their personal data as decided in G9.1.
- **R9.8** The delete action is reachable inside the app on iOS, Android and web.

Operations:

- **R9.9** Sentry reports errors from the app and the API, with releases and source maps. No address, token or message body is sent to Sentry.
- **R9.10** An alert fires for a job that has passed its retry limit and for a spike in the API's error rate.
- **R9.11** Secrets live in the Fly, EAS and GitHub secret stores. A test or a CI check fails if the app bundle contains the Supabase secret key.

## Tests to write first

- The three sweeps in R9.1 to R9.3.
- Each rate limit: the request after the limit returns 429, and a different user is not affected.
- Deletion with an open rental returns 409. Deletion without one archives the listings and removes the push tokens.
- A deleted user's token no longer works.

## Done when

- [ ] The three sweeps pass, with the command and output shown.
- [ ] The restore rehearsal worked, and you wrote down how long it took.
- [ ] The security advisor reports nothing unresolved.
- [ ] A full rental between two real people on two phones went through without help.
- [ ] The apps are submitted.

## Gaps filled

- **G9.1 What account deletion removes.** The proposal only says deletion is refused while a rental is open. Rentals, events, messages and handover photos are evidence for the other person, and privacy law limits what you may keep. This needs your decision and a lawyer's view. Default until then: blank the display name and avatar, delete the auth user, keep the rental records.
- **G9.2 Rate limit numbers.** The proposal names what is limited but gives no numbers. Choose them before this step. Claude must not invent them.
- **G9.3 Sign-in limits.** The proposal lists sign-in among the API's rate limits, but sign-in goes from the app to Supabase Auth. It is a Supabase setting, listed above under "You do by hand".
- **G9.4 Route.** `DELETE /v1/me` is not in the proposal's endpoint table.
