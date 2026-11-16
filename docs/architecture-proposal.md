# Outdoor Gear Rental Marketplace: Architecture Proposal

Nov 15, 2026 · @Raphael Vermeil

## The short version

Build one Expo app for iOS, Android and web, one TypeScript API, and one Postgres database. The MVP moves no money: renter and owner pay each other directly, and the app records that they did. There are no microservices, no Redis, no search engine and no second web codebase.

| Layer | Pick |
| --- | --- |
| Clients | Expo SDK 58 with Expo Router: one codebase for iOS, Android and web |
| API | Node.js with Hono, a modular monolith, REST-style JSON |
| Data | Postgres with PostGIS on Supabase, plus Supabase Auth, Storage and Realtime |
| Jobs | pg-boss, inside the same Postgres |
| Money | None in the app. Users settle by e-transfer or cash; in-app payments are a Phase 2 option |
| Hosting | Fly.io for the API, EAS for app builds and the web app |

### Where I disagree with the brief

| Your brief | My recommendation | Why |
| --- | --- | --- |
| One cart submitted as one rental plan | A trip that fans out into one independent rental per owner | Three people cannot commit atomically. Each owner needs their own request and handover. |
| Payment processing | None in the MVP: users pay each other and the app records it | It removes the largest build step and keeps you out of money disputes. Section 6 lists what it costs. |
| Accepted, then Confirmed | One step: accepting confirms | With no payment to wait for, a second state adds nothing. |
| Use the real location to rank by distance | Filter, rank and display from a snapped public point only | Distances computed from the real point can be reversed by trilateration. |
| Optional deposit | The owner collects it directly; the app records "received" and "returned" | Holding deposits yourself is regulated and makes you the judge of every dispute. |
| A conversation per rental request | One conversation per renter-owner pair, messages tagged with the rental | People ask questions before requesting, and rent from the same owner again. |
| A real-time messaging system | Messages saved through the API; Supabase Realtime only signals "refetch" | Same experience for users, no WebSocket server to run. |
| QR codes prevent disputes | Keep the QR, but rely on who scans, photos and an audit log | A QR proves two phones met. It says nothing about the gear's condition. |
| Potentially cars | Leave cars out | Vehicle rental brings insurance and registration rules. It is a different product. |
| Consider Redis and caching | No server-side cache in the MVP | Nothing in the MVP workload needs one. Section 7 lists the triggers. |

The hard problems here are trust and liquidity, not architecture: whether owners will lend to strangers, and whether a renter can find a full kit nearby. A release without payments tests both at the lowest cost. It gives up revenue and enforcement, which section 6 spells out.

I assumed a Montreal launch, whole-day rentals and a team of one to three. The last section lists the decisions I need from you.

## 1. Product and workflow analysis

The unit of this product is a rental with one owner. A trip is a wrapper that groups those rentals for one renter.

### How it works for a renter

1. Start a trip: a name, dates and a starting point.
2. Search near that point for gear that is free on those dates, and add items to the trip.
3. Review the trip. Items are grouped by owner, each group with its area, dates, estimated price, deposit asked, owner rating and rules.
4. Send all requests with one tap. The app sends one request per owner.
5. Each owner answers within 24 hours. The trip shows "2 of 3 confirmed" and suggests replacements for anything declined.
6. On confirmation the exact pickup address appears. Chat with that owner is already open.
7. At pickup the renter pays the owner by e-transfer or cash, photographs the gear and scans the owner's QR code.
8. At return the owner scans the renter's code and hands back any deposit. Both leave a review.

### How it works for an owner

1. List an item: photos, category, size attributes, condition, daily price, deposit asked and pickup location.
2. Receive a request and accept or decline within 24 hours.
3. At pickup, collect the payment and any deposit, then show the QR code.
4. At return, check the gear, scan the renter's code and hand back the deposit.

### The trip model

- **A trip reserves nothing.** Items in a trip are a wish list. Availability and price are rechecked on the trip screen and again at submit.
- **One rental per owner.** A rental has one owner, one date range, one pickup and one return. Different dates with the same owner means two rentals.
- **Submit sends what is available.** If an item was taken in the meantime, that owner's request is held back and named as a conflict. The other requests go out.
- **A pending request blocks the dates.** It expires after 24 hours, or sooner when pickup is close. [Airbnb blocks nights for pending requests](https://www.airbnb.com/help/article/3612) in the same way.
- **Owners answer for their whole group.** A decline carries a reason, such as "the stove is broken", so the renter can resubmit without that item.
- **Partial outcomes stand.** Accepted rentals stay confirmed when another owner declines. The renter can cancel any of them before pickup.

The alternative is to let pending requests overlap so owners choose between renters. It needs auto-decline logic and leaves renters guessing, so I would not start there.

### Rental states

_[Diagram, not included in this export: rental lifecycle · 4 main states, 3 exits]_

Compared with your list, `accepted` is merged into `confirmed`, and `expired` is new. A request costs nothing to send, so a cap on open requests replaces a card hold as the brake on spam.

### Gaps in the brief

| Gap | Why it matters | MVP answer |
| --- | --- | --- |
| Damage, loss and theft | The main reason people hesitate to lend gear | The owner may ask for a deposit and holds it directly. The app records it, stores handover photos and shows reviews |
| No revenue | The MVP earns nothing | Accepted while you test demand; in-app payments with a commission are the first Phase 2 candidate |
| Cancellations and no-shows | Nothing enforces a commitment | Either side can cancel before pickup; no-shows are reported to you; repeat offenders are removed |
| Late returns | The rental stays active past its end date | Reminders to both parties, then a report |
| Questions before requesting | "Does the tent include a footprint?" decides the rental | Chat can start from a listing |
| Sizes | Skis, boots, bikes and wetsuits are useless in the wrong size | Category-specific attributes that search can filter |
| Quantity | Some owners have four identical kayaks | One listing is one physical item for now |
| Life-safety gear | A failed rope or avalanche beacon can injure someone | Exclude ropes, harnesses, helmets and avalanche gear at launch |
| Back office | Reports and bans need a tool | The Supabase dashboard at first; no admin screen in the MVP |
| App store review | A rejection delays launch | In-app account deletion, and Sign in with Apple next to Google sign-in |
| Tax and liability | Rental income is the owner's to declare, and gear can still injure someone | The terms state that the rental is between the two users; have a lawyer review them |

### Edge cases to decide now

- **Simultaneous requests for the same dates:** a database constraint lets one through; the other sees a conflict.
- **Price changes while an item sits in a trip:** the trip shows the live price; the rental stores a snapshot at submit.
- **Renter cannot pay at pickup:** the owner keeps the gear and cancels.
- **Deposit not returned:** the renter reports it. The handover log shows the deposit was recorded, and you can warn or remove the owner. You do not move money.
- **Owner archives a listing with open rentals:** blocked until those rentals end.
- **No signal or a dead phone at handover:** a 6-digit code replaces the scan. Failing that, one party reports the handover and the other has 24 hours to contest it.
- **Owner refuses to confirm a return:** the renter files a return report with photos; it confirms itself after 24 hours.
- **Gear never comes back:** overdue reminders, then a report. The owner keeps the deposit, and the app's records are the evidence for anything beyond it.
- **Return and next pickup on the same day:** not allowed in the MVP. Rentals use whole days and the end date is inclusive.
- **Time zones:** rental dates are calendar dates at the pickup location, stored as dates and not timestamps.
- **Account deletion with an open rental:** refused until the rental completes.

## 2. Recommended technology stack

Every pick favours fewer moving parts: TypeScript on both sides, one database doing four jobs, and managed services for auth, files and push.

| Layer | Pick | Why | Considered and rejected |
| --- | --- | --- | --- |
| App: web, iOS, Android | Expo SDK 58, Expo Router, React Native Web, TypeScript | One codebase, and your React experience carries over. [SDK 58 made server rendering stable](https://expo.dev/changelog/sdk-58), which covers SEO and link previews for listing pages. | Next.js for web plus Expo for mobile (two UIs to maintain); Flutter (new language, weaker web); fully native apps |
| Client data and forms | TanStack Query, Zod, React Hook Form | Server state lives in the query cache. No global store is needed. | Redux or Zustand (nothing to put in them yet) |
| Styling | React Native StyleSheet, one theme file, your own components | No dependency risk. [NativeWind v5 is still a release candidate](https://www.nativewind.dev/v5/getting-started/installation). | NativeWind v4 (built on Tailwind 3); Tamagui (heavy) |
| API | Node.js, Hono, Zod validation, REST-style JSON | Close to Express in feel, fully typed, and its client gives end-to-end types without code generation. | Express (untyped); NestJS (the abstraction you want to avoid); tRPC and GraphQL (see below); a Supabase-only backend (see below) |
| Database | PostgreSQL with PostGIS and btree\_gist, on Supabase in [Canada Central](https://supabase.com/docs/guides/platform/regions) | Transactions, exclusion constraints and geospatial indexes in one engine. | MongoDB (no exclusion constraints, weaker joins); MySQL (weaker GIS and range types); Firestore |
| Data access | Drizzle ORM 0.45 with SQL migrations; raw SQL for geo queries and constraints | Thin and SQL-shaped. Version 1.0 is still a release candidate, so stay on 0.45. | Prisma (fights raw SQL and PostGIS); Kysely (fine, a little more manual) |
| Authentication | Supabase Auth: email, Apple and Google sign-in, plus SMS codes for phone verification. The API verifies tokens against the project's [public signing keys](https://supabase.com/docs/guides/auth/signing-keys). | Already in the platform, and users live in your Postgres. | Clerk (cost, another vendor); Better Auth (more to own) |
| File storage | Supabase Storage: a public bucket for listing photos behind the CDN, a private bucket for handover evidence | Direct uploads through signed URLs, resizing on request. | S3 or R2 with your own image pipeline (move there if egress cost grows) |
| Real-time | Supabase Realtime Broadcast, one private channel per user | The server publishes with a SQL function, so there is no socket server to run. | Socket.IO (a stateful server to scale and reconnect); Postgres Changes ([Supabase points new work to Broadcast](https://supabase.com/docs/guides/realtime/getting_started)); polling (the fallback) |
| Notifications | Expo Push Service for iOS and Android, Resend for email, an inbox table in the app | [Expo notifications do not cover web](https://docs.expo.dev/guides/using-push-notifications-services/), so web gets the inbox and email. | OneSignal (another vendor); web push (postponed) |
| Background jobs | pg-boss in the same Postgres; the worker runs inside the API process at first | A job can be enqueued [inside the same transaction](https://timgit.github.io/pg-boss/api/adapters) as the state change. | BullMQ with Redis (extra infrastructure, no transactional enqueue); pg\_cron with Edge Functions (logic split across runtimes) |
| Caching | The CDN for images, HTTP cache headers on public reads, TanStack Query on the client | Section 7 explains what is cached and why nothing else is. | Redis (no concrete need yet) |
| Payments | None in the MVP | Users pay each other by e-transfer or cash. That removes the largest build step and the questions around holding other people's money. | Stripe Connect with a commission (Phase 2, once demand is proven); holding deposits yourself (section 6) |
| Hosting | API on Fly.io in [Toronto](https://fly.io/docs/reference/regions), one Docker image. Web on EAS Hosting. Mobile through EAS Build, Submit and Update. | A long-running process suits a connection pool and a job worker. | Vercel or Lambda for the API (no home for the worker, pooling problems); Kubernetes (operations overhead) |
| Monitoring | Sentry in the app and the API, structured JSON logs, an uptime check | Enough to see every error. | A full observability stack (later) |

### One Expo codebase is realistic, with two platform splits

Screens, navigation, data fetching and validation are shared across all three platforms. Two features need a native and a web implementation behind one interface each:

- **QR scanning.** Scanning is a phone flow. Web displays codes and accepts the 6-digit fallback.
- **Maps.** [react-native-maps has no web target](https://docs.expo.dev/versions/latest/sdk/map-view/). The MVP ships a distance-sorted list; a map arrives in Phase 2 with MapLibre on both sides.

Web is for browsing, booking, managing and chat; handover happens on phones. SDK 58 is a month old, so if server rendering misbehaves, set `web.output` back to `static`. That is a configuration change, not a rewrite.

### Supabase is infrastructure here, not the backend

The app never queries tables directly. Row-level security filters rows, not columns, so keeping an exact address private would depend on getting every table split and every policy right. Rental transitions also need multi-step transactions that policies cannot express.

Row-level security is therefore enabled with no policies on every app table, and only the API's server role can read or write them. You keep managed Postgres, auth, storage and realtime, and can replace any one of them later.

### REST with a typed client, not tRPC or GraphQL

Routes stay plain HTTP, so universal links, HTTP caching and any future third-party client work without adapters. Hono's `hc` client still gives the app compile-time types for every route. Keep one router per module, because type inference slows down as a single route tree grows.

Pin exact versions everywhere. Expo and the styling libraries release on different schedules.

## 3. System architecture

Clients reach business data through one API process. Everything else is a managed service that the API or the app talks to.

_[Diagram, not included in this export: system architecture · one app, one API, one database, three services]_

The app talks to Supabase directly only for sign-in, photo uploads and live events. Supabase Auth, Storage, Realtime and Postgres belong to the same Supabase project. No payment provider appears, because money moves between the two users outside the system.

### How the parts talk

- **App to API:** HTTPS and JSON, with the Supabase access token as a bearer token. This is the only path to business data.
- **App to Supabase:** sign-in, photo uploads to signed URLs that the API issues, and one Realtime subscription.
- **API to Postgres:** a small connection pool. Each state change is one transaction.
- **Worker to the outside:** push through Expo and email through Resend.

### The three data flows

1. **Read.** A screen calls the API, the API runs a query, and TanStack Query caches the result on the device.
2. **Write.** A command such as "accept" opens a transaction, locks the rental and checks the transition. It then writes the new status, an audit event, notification rows, jobs and a Realtime event, and commits once.
3. **Async.** After the commit the worker picks up the jobs: send push and email now, expire the request in 24 hours, remind before pickup.

Jobs, events and data share one transaction, so a crash cannot leave a confirmed rental without its notification. Nothing outside the database takes part in a state change.

### Realtime is a signal, not a data source

Events carry ids only: "rental 42 changed" or "new message in conversation 7". The app reacts by refetching through the API, and also refetches on focus and reconnect, so a lost event costs nothing. Access rules stay trivial: a user can subscribe to their own channel and nothing else.

### How it evolves

| When this happens | Change this |
| --- | --- |
| You decide to add in-app payments | Add a payments module with Stripe Connect, a webhook route, and an `awaiting_payment` state in front of `requested` |
| Deploys interrupt jobs, or API latency rises during job bursts | Run the worker as its own process from the same image |
| One API machine is a single point of failure you can no longer accept | Run two machines; the queue and the database constraints already tolerate it |
| Search p95 above roughly 300 ms | Add a read replica for search, then a search engine if text relevance matters |
| Storage egress dominates the bill | Move photos to object storage with a dedicated image CDN |
| SEO becomes the main acquisition channel and Expo web limits it | Add a Next.js site for public pages on the same API and shared package |
| A module needs its own scaling or its own team | Extract that module; the boundaries already exist |

## 4. Database design

Three rules carry the integrity of the system: an exclusion constraint makes double booking impossible, one function owns rental status, and prices are frozen at request time.

_[Diagram, not included in this export: entity relationships · the booking core, 13 tables]_

`rentals` is the centre: events, handover records, reviews and reports all hang off one rental. Not drawn, to keep the picture readable: a rental also points at its renter and owner in `users`, and `trip_items` points at `listings`.

### Tables

| Table | Key fields | Constraints and notes |
| --- | --- | --- |
| users | id (same as the auth user), display name, avatar, phone\_verified\_at, rating averages | One row per auth user |
| pickup\_locations | user\_id, address, exact\_point, public\_point, precision | exact\_point stays on the server until a rental is confirmed; public\_point is the exact point snapped to a grid |
| categories | parent\_id, slug, attribute\_schema | Two levels; the schema lists the size attributes of each category |
| listings | owner\_id, pickup\_location\_id, category\_id, title, description, condition, daily\_price\_cents, deposit\_cents, attributes, public\_point (copy), status, search vector | status is draft, active, paused or archived; rows are never hard-deleted; price and deposit are information for the two users |
| listing\_images | listing\_id, storage\_path, position | Paths are immutable; a new upload gets a new path |
| availability\_blocks | listing\_id, period, kind, rental\_item\_id | Exclusion constraint on listing and period; kind is owner\_block or rental |
| trips | renter\_id, name, start\_date, end\_date, status | The cart; status is draft or submitted |
| trip\_items | trip\_id, listing\_id, start\_date, end\_date | Unique per trip and listing; reserves nothing |
| rentals | trip\_id, renter\_id, owner\_id, period, status, expires\_at, pickup\_location\_id, quoted\_total\_cents, deposit\_cents, currency, cancelled\_by, one timestamp per transition | Renter and owner must differ; status changes only through the transition function |
| rental\_items | rental\_id, listing\_id, title\_snapshot, daily\_price\_cents, days, line\_total\_cents | Price and title frozen at submit |
| rental\_events | rental\_id, type, actor\_id, from\_status, to\_status, data, created\_at | Append-only: the API's database role has no UPDATE or DELETE on it. Also holds the "payment received", "deposit received" and "deposit returned" confirmations |
| handover\_tokens | rental\_id, kind, token\_hash, code\_hash, issued\_by, expires\_at, used\_at | Single-use; kind is pickup or return |
| handover\_photos | rental\_id, kind, uploader\_id, storage\_path, sha256, created\_at | Private bucket; the hash is recorded at upload |
| reports | reporter\_id, reported\_user\_id, rental\_id, reason, note, status | A problem raised by a user; you handle it, and no money is involved |
| reviews | rental\_id, author\_id, subject\_id, role, rating, body, published\_at | One per author per rental; only after a confirmed handover; published when both exist or after 14 days |
| conversations | user\_low\_id, user\_high\_id, last\_message\_at, read markers | One row per pair of users, enforced by a unique constraint |
| messages | conversation\_id, sender\_id, kind, body, rental\_id, listing\_id, created\_at | kind is text or system; rental\_id tags the context |
| notifications | user\_id, type, payload, rental\_id, read\_at | The in-app inbox |
| push\_tokens | user\_id, expo\_token, platform, last\_seen\_at | Unique token |

All ids are UUIDs, so they cannot be enumerated. All money is integer cents with a currency code.

### Availability: one table, one constraint

```sql
create extension if not exists btree_gist;

create table availability_blocks (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid not null references listings(id),
  period         daterange not null,
  kind           text not null check (kind in ('owner_block', 'rental')),
  rental_item_id uuid unique references rental_items(id) on delete cascade,
  check ((kind = 'rental') = (rental_item_id is not null)),
  exclude using gist (listing_id with =, period with &&)
);
```

- Owner blackout dates and rentals share this table, so one constraint covers both. A listing is free on a range when no block overlaps it.
- Submitting a rental inserts one block per item. Declining, expiring or cancelling deletes them in the same transaction as the status change.
- Two concurrent submits cannot both succeed. Postgres rejects the second insert, whatever the application code does.
- A period is stored as start up to, but excluding, the day after the end date. That is how an inclusive end date is expressed.
- Multi-quantity listings later add a `listing_units` table and move the constraint from the listing to the unit.

### Rental status: one function owns it

- A single `transitionRental(tx, rentalId, event, actor)` function holds the transition table. No other code writes `rentals.status`.
- It locks the rental row first with `select ... for update`. Accept, expire and withdraw on one rental therefore run one at a time.
- An invalid transition returns a conflict. A repeated one returns success, so job retries and repeated requests are harmless.
- The same function writes the `rental_events` row, which makes the audit log complete by construction.

### Multi-owner trips in the schema

A trip with three owners becomes three `rentals` rows that share a `trip_id`. Each has its own items, events and handover. Nothing in the database ties their outcomes together; the trip's status on screen is computed from its rentals.

## 5. API design

The API is a set of resources plus explicit commands. State changes are verbs such as `accept` and `scan`, never a generic status update.

### Conventions

- The base path is `/v1`, with JSON in and out. Every request and response body has a Zod schema in the shared package.
- Commands are `POST /resource/:id/verb`, and each maps to one state-machine event.
- Lists use cursor pagination: `?cursor=...&limit=...`, returning `next_cursor`.
- Retries are safe without extra machinery. Database constraints reject a duplicate request, and a repeated command returns the first result.
- Errors share one shape: a stable `code`, a readable `message` and optional `details`. A booking conflict is a 409 that names the conflicting listings.
- Responses are built from explicit output schemas. A new table column is not exposed until a schema names it.

### Main endpoints

| Endpoint | Purpose | Who may call it |
| --- | --- | --- |
| `GET /v1/listings?lat&lng&radius_km&from&to&category&q&cursor` | Search nearby gear that is free on the dates | Anyone |
| `GET /v1/listings/:id` | Listing detail, with the public point only | Anyone |
| `POST /v1/listings`, `PATCH /v1/listings/:id` | Create and edit a listing | Owner |
| `POST /v1/listings/:id/images` | Get a signed upload URL | Owner |
| `PUT /v1/listings/:id/blocks` | Set blackout dates | Owner |
| `POST /v1/trips`, `GET /v1/trips/:id` | Create a trip; view it grouped by owner with live price and availability | Renter |
| `POST /v1/trips/:id/items`, `DELETE /v1/trips/:id/items/:itemId` | Add or remove items | Renter |
| `POST /v1/trips/:id/submit` | Create one rental request per owner and report any conflicts | Renter |
| `GET /v1/rentals?role=...&status=...` | List my rentals as renter or as owner | Participant |
| `POST /v1/rentals/:id/accept`, `/decline`, `/cancel` | Owner decision; cancellation by either side | Owner; either participant for cancel |
| `GET /v1/rentals/:id/pickup-details` | The exact address | Participant, once confirmed |
| `POST /v1/rentals/:id/handover-tokens` | Issue a 60-second QR token and code, with the payment and deposit confirmations | Owner for pickup, renter for return |
| `POST /v1/handovers/scan` | Redeem a token or code; start or end the rental | The other party |
| `POST /v1/rentals/:id/handover-reports` | A one-sided pickup or return report with photos | Participant |
| `POST /v1/reports`, `POST /v1/rentals/:id/reviews` | Report a problem; leave a review | Signed-in user; participant |
| `GET /v1/conversations`, `GET` and `POST /v1/conversations/:id/messages` | Chat | Member of the pair |
| `GET /v1/notifications`, `POST /v1/push-tokens` | Inbox; register a device | Signed-in user |

### Authentication and authorization

- The app signs in with Supabase Auth and sends the access token on every request.
- The API verifies the token's signature locally against the project's published keys, then loads the user row. There is no call to Supabase per request.
- Authorization is by resource, not by role. Every rental, conversation and listing handler starts with an ownership check such as `assertParticipant(rental, user)`.
- Anyone can rent and lend, so there is no owner account type. There is no admin role in the MVP either: you work in the Supabase dashboard.

### Real-time events and notifications

- One event catalogue lives in the shared package: `rental.updated`, `trip.updated`, `message.created`, `notification.created`.
- The transition function calls [`realtime.send()`](https://supabase.com/docs/guides/realtime/broadcast) inside its transaction, addressed to `user:<id>` for each party. A rolled-back change emits nothing.
- The app holds one subscription and maps each event to a cache invalidation.
- One row in `notifications` fans out per channel: the inbox reads the table, and the worker sends push and email.
- Push and email carry ids and one short line of text, never an address.
- A message to someone who has that conversation open shows no banner; the app suppresses it in the foreground.

## 6. Critical workflows

Each workflow below is the simplest version that stays correct under retries, races and a crashed process.

### Discovering nearby equipment

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

- `public_point` is the owner's exact point snapped to a grid of about 1 km. It is computed once, when the pickup location is saved. Rural owners can pick a coarser grid.
- Filtering, ordering and the distance shown all use the snapped point. The exact point takes no part in any public query.
- Rounding a true distance is not enough. [A researcher located Bumble users](https://robertheaton.com/bumble-vulnerability) by trilaterating from rounded distances, and [Tinder's fix](https://robertheaton.com/2018/07/09/how-tinder-keeps-your-location-a-bit-private/) was to snap the location itself before calculating anything.
- Snapping is deterministic. Editing an address cannot be used to average out noise, and every listing at one address shares one public point.
- The exact address leaves the server through one endpoint, `pickup-details`, and only for a participant of a confirmed or active rental.
- Listing photos are re-encoded before they become public, which strips GPS metadata.
- Owners can set a public meeting place as the pickup location instead of their home.

### Adding equipment from several owners to a trip

1. `POST /trips/:id/items` stores the listing and dates. Nothing is reserved and no owner is notified.
2. `GET /trips/:id` groups items by owner and marks each one available, unavailable or price-changed, computed live.
3. Items with the same owner and dates form one future rental. Different dates form separate rentals, shown as separate cards.
4. The screen totals each card and the trip: the estimated price, and the deposit each owner asks for. Nothing is charged.

### Submitting requests to several owners

1. The app calls `POST /trips/:id/submit`.
2. For each owner, one transaction creates the rental in `requested`, its items with price snapshots, and one availability block per item.
3. If an item was taken in the meantime, that owner's transaction rolls back and the response names the item. The other owners' requests still go out.
4. Each owner is notified, and a job is set to expire the request after 24 hours.
5. A renter can hold at most 10 open requests. With no card hold, this cap is the brake on spam.

### Partial acceptance and rejection

- **Accept:** lock the rental, check it is still `requested`, move it to `confirmed` and reveal the address.
- **Decline or expire:** delete the availability blocks and notify the renter. Each decision touches one rental only.
- **Trip screen:** shows the mix and, for each lost item, a search prefilled with the same category, dates and area.
- **Cancel:** either side can cancel a confirmed rental before pickup. The dates are freed, the other party is notified, and the cancellation stays on the canceller's record.
- **Per-item acceptance** within one owner's group waits for Phase 2. It is really a counter-offer and needs the renter's consent.

### Money between users

The app never holds, moves or refunds money. It records what the two people confirm.

| Moment | What happens | What the app records |
| --- | --- | --- |
| Listing | The owner states a daily price and, if they want one, a deposit | Price and deposit on the listing |
| Request | The app shows an estimated total: days times the daily price | A price snapshot on the rental |
| Pickup | The renter pays by e-transfer or cash and hands over any deposit | "Payment received" and "deposit received", confirmed by the owner before the QR appears |
| Return | The owner hands the deposit back | "Deposit returned" or "deposit kept", confirmed by the renter |
| Problem | The two people sort it out, and either can report the other | A report, with the handover log and photos attached |

- **What this buys.** No payment provider, no owner onboarding, no refunds or chargebacks, and no role as judge over other people's money.
- **What it costs.** No revenue, no enforced cancellation rules, more no-shows, and no way to make anyone pay beyond the deposit the owner holds.
- **Why not hold only the deposit yourself.** Holding funds for users [can require registration with the Bank of Canada](https://www.bankofcanada.ca/core-functions/retail-payments-supervision/retail-payments-supervision-supervisory-policies-and-guidelines/criteria-for-registering-payment-service-providers/). A card hold also [expires after 5 to 7 days](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), and a charge refunded later [still costs the processing fee](https://support.stripe.com/questions/understanding-fees-for-refunded-payments).
- **Terms of use.** They state that the rental is an agreement between the two users. Have a lawyer review them.
- **When to add payments.** When no-shows or deposit disputes become the main complaint, or when you want revenue. Offer it then as an optional protected rental, because users will be used to paying each other.

### Messaging

1. `POST /conversations/:id/messages` inserts the message, updates `last_message_at`, writes a notification row, enqueues a push job and emits `message.created`, all in one transaction.
2. If the recipient's app is open, it receives the event and refetches the thread. If not, the push arrives.
3. Opening a thread loads the latest page by cursor and marks it read.
4. Rental transitions insert system messages such as "Request sent for Tent, 3 to 5 July", so the thread reads as a timeline.
5. A conversation can start from a listing before any request. Messages carry a `listing_id` or `rental_id` for context and as evidence in a dispute.

Typing indicators, read receipts and presence are left out of the MVP.

### Pickup validation with QR codes

1. The owner opens the rental, confirms "payment received" and any "deposit received", and taps "Hand over".
2. The app requests a token: 128 random bits, stored hashed, valid for 60 seconds, single use. The app redraws the QR every 45 seconds.
3. The renter checks the gear, takes at least one photo per item with the in-app camera, and scans.
4. The API accepts the scan only if the token is unexpired and unused, the scanner is this rental's renter, the rental is `confirmed`, and the date is inside the rental period or the day before.
5. One transaction marks the token used, moves the rental to `active` and records the event with the owner's confirmations. Both phones update.
6. If the camera fails, the renter types the 6-digit code shown under the QR. It follows the same rules, limited to five attempts per rental every ten minutes.

Three properties make this safe without heavy cryptography:

- A screenshot is useless to a third party, who is not the renter. It is useless later, because the token has expired or been used.
- The party who would lose from a false confirmation is the one who scans. The renter accepts responsibility at pickup, and the owner releases it at return. Your proposed scanning direction is already right.
- The QR payload is a link to the app, so the phone's own camera can open it.

### Return validation and disputes

1. The renter taps "Return", confirms "deposit returned" or "deposit kept", and shows a token. The owner inspects the gear and scans it.
2. The owner picks "All good" or "There is a problem". Both move the rental to `completed`. The second also files a report with photos and a note.
3. A return is never blocked by disagreement. Recording that the gear is back and judging its condition are separate steps.
4. Reviews open at completion. A review exists only for a rental with a confirmed handover, which keeps reviews trustworthy.
5. A dispute over damage or a deposit is between the two people. Both can see the pickup photos, return photos and handover log, and you can warn or remove a user.
6. If one party cannot or will not scan, the other files a handover report with photos. The counterparty has 24 hours to contest it before it stands.

The app keeps evidence and reputation and does not arbitrate money. That boundary is what keeps the MVP small.

## 7. Scalability and performance

One small Postgres instance and one API machine carry this product well past launch. The plan is to index correctly now and add infrastructure only when a measurement asks for it.

### Indexes

| Table | Index | Serves |
| --- | --- | --- |
| listings | GiST on `public_point`, partial where status is active | Radius filter and nearest-first ordering |
| listings | GIN on the search vector | Text search |
| listings | `owner_id`; `category_id` | Owner dashboard; category filter |
| availability\_blocks | The exclusion constraint's own GiST index on listing and period | The "free on these dates" check |
| rentals | `(renter_id, status)`; `(owner_id, status)` | "My rentals" lists |
| rentals | `expires_at`, partial on open statuses | The expiry sweeper |
| rental\_events | `(rental_id, created_at)` | Timeline and audit |
| messages | `(conversation_id, created_at desc, id)` | Thread pagination |
| conversations | `(user_low_id, last_message_at desc)` and the same for `user_high_id` | Inbox |
| notifications | `(user_id, created_at desc)`, plus a partial index on unread | Inbox and badge count |

### What is cached, and what is not

| Data | Where | How it stays fresh |
| --- | --- | --- |
| Listing photos | CDN | Immutable paths; an edit uploads a new file |
| Category tree | HTTP cache for an hour, and the client | Changes ship with a deploy |
| Public listing page | HTTP cache for 60 seconds, then stale-while-revalidate | Short lifetime; availability is fetched separately and never cached |
| A user's rentals, trips and messages | TanStack Query on the device | Invalidated by Realtime events, focus and reconnect |
| Token signing keys | API process memory | Refetched when an unknown key id appears |
| Search results | Not cached | Too many combinations of point, dates and filters; the indexed query is fast enough |

The invalidation rule is to prefer immutable URLs and short lifetimes over purge logic. The only event-driven invalidation is on the client, where the next refetch repairs a missed event.

Redis earns its place when one of two things appears: several API machines that need shared counters at a volume Postgres handles poorly, or a hot read that measurably loads the database. Neither exists in the MVP.

### Images

- The app resizes each photo to a long edge of about 2,000 px and re-encodes it before upload. That shortens uploads and strips metadata.
- Uploads go straight to storage through a signed URL. The API never proxies image bytes.
- Screens request sized variants, such as thumbnail, card and full, through the storage transformation URL.
- The worker verifies each new listing photo before the listing can go active.

### Pagination

- Feeds ordered by time, such as messages, notifications and rentals, use a `(created_at, id)` cursor.
- Search uses a `(distance, id)` cursor inside a capped radius, 30 results a page, with infinite scroll in the app.
- No endpoint offers page numbers or an unbounded list.

### Background jobs

| Job | Trigger | Effect |
| --- | --- | --- |
| Expire unanswered requests | At `expires_at` | Frees the dates, tells the renter |
| Reminders | 24 hours before pickup and before return | Push and email to both parties |
| No-show and overdue checks | Hourly | Flags the rental and notifies both parties and you |
| Settle one-sided handover reports | 24 hours after the report | The report stands unless it was contested |
| Push and email delivery | Each notification | Retries with backoff; removes dead push tokens |
| Photo verification | Each upload | Rejects files that still carry location metadata |
| Sweeper | Every 5 minutes | Re-runs any timed transition whose job was lost |

Every job calls the same idempotent transition function, so running one twice is harmless.

### Rate limits and connections

- Per-user and per-IP limits inside the API process cover sign-in, search, messaging and scans. With one or two machines, in-memory counters are accurate enough.
- Business limits matter more now that a request costs nothing, and they live in SQL. I suggest at most 10 open requests per renter, and 3 a day for accounts under a week old.
- The API keeps one pool of about 10 connections for its whole life. pg-boss uses a small pool of its own on the same database.
- A long-running server does not need the transaction-mode pooler. That only becomes relevant if you move to serverless functions.

### Likely bottlenecks, in order

1. Photo weight and egress, long before any database limit.
2. The search query in a dense city with wide date ranges. A read replica is the first response.
3. A single API machine during a deploy or a crash. A second machine fixes it.
4. Network distance between the API in Toronto and the database in Montreal. I have not measured it, so keep queries per request low and watch p95 from the first week.

Chat is not on this list. A rental produces a handful of messages.

## 8. Security and reliability

Three failures could end this marketplace: a leaked home address, a double booking and a handover nobody can prove. The table starts with those.

| Risk | Controls |
| --- | --- |
| An exact location leaks | The exact point sits in its own table; every public value derives from the snapped point; one gated endpoint; metadata stripped from photos; no addresses in logs, analytics, push or email |
| Double booking | The exclusion constraint; each owner's request in one transaction |
| Handover fraud | 60-second single-use tokens bound to the counterparty; the party with something to lose does the scanning; hashed photos; an append-only event log |
| Money disputes land on you | The app never holds money; the terms state that the rental is between the two users; both can see the handover log and photos; you can warn or remove users |
| Direct table access through Supabase | Row-level security on, with no policies, for app tables; the app holds only the publishable key; the secret key exists only on the server; Supabase's security advisor run before each release |
| Reading or changing someone else's rental | An ownership check at the top of every handler; UUID ids; an automated test that calls every rental and conversation endpoint as a non-participant |
| Illegal status jumps and races | One transition function; a row lock; tests over the whole transition table |
| Fake accounts and spam requests | Verified email, and a phone number verified by SMS before a first request or listing; caps on open requests; reports; removal of repeat offenders; identity checks in Phase 2 |
| Abuse in chat | Report and block; rate limits; you can read a reported thread |
| Malicious uploads | Signed URLs limited by type and size; re-encoding; a private bucket for evidence, served through short-lived signed URLs |
| Token theft | Short-lived access tokens with refresh rotation; secure storage on the device; signing keys that can be rotated |
| Data loss | Daily backups, plus point-in-time recovery once losing a day of data is unacceptable; a restore rehearsal before launch |
| A provider is down | Push or email: jobs retry. Realtime: the app still works by refetching. Database: the API returns errors and nothing is half-written |
| Leaked secrets | Kept in the Fly and EAS secret stores; never in the repository or the app bundle |

### Operational basics

- **Logging:** structured JSON with a request id, user id and rental id on every line. Addresses, tokens and message bodies are never logged.
- **Errors:** Sentry in the app and the API, with releases and source maps.
- **Alerts:** jobs past their retry limit and error-rate spikes. Each should reach your phone.
- **Health:** `/healthz` checks the database and the queue, and Fly restarts an unhealthy machine.
- **Migrations:** forward-only SQL files, run in CI before the new code starts. Destructive changes ship in two steps.
- **Environments:** local, staging and production, each with its own Supabase project.

### Privacy and compliance

Hosting the database in Canada Central keeps personal data in Canada. Quebec's Law 25 and PIPEDA still call for a privacy policy, consent, deletion on request and breach handling. I am not a lawyer, so have the policy and the terms reviewed before launch.

## 9. Development roadmap

The MVP is the complete rental loop in one city, without money: list, find, request, hand over, return, review. Anything that does not close that loop waits.

_[Diagram, not included in this export: roadmap · 3 phases, 2 gates]_

Each gate is a condition, not a date. Trip templates are packing lists per activity, such as a camping weekend, that turn into one search per missing item.

### MVP build order

1. **Foundations.** Monorepo, CI, three environments, the Supabase project, sign-in and user profiles.
2. **Listings.** Create and edit, photos, categories with size attributes, price and deposit, pickup location with the snapped point.
3. **Search.** A nearby list with date and category filters, and server-rendered listing pages.
4. **Trips.** Add items, group by owner, show live availability and price.
5. **Rentals.** The state machine, availability blocks, expiry jobs and transition tests.
6. **Notifications and chat.** The inbox table, push, email, Realtime events and conversations.
7. **Handover.** QR tokens, the code fallback, photo capture, payment and deposit confirmations, and one-sided reports.
8. **Trust.** Reviews, reports and blocking.
9. **Hardening.** Authorization tests, rate limits, a restore rehearsal and store submission.

Each step unblocks the next. Chat depends only on users, so it can move earlier if you want testers talking. Payments are no longer a step: they return in Phase 2 as a separate module, with an `awaiting_payment` state in front of `requested`.

### In the MVP, prepared for, and postponed

| Area | In the MVP | The design is ready for | Deliberately postponed |
| --- | --- | --- | --- |
| Payments | Users pay each other, and the app records it | A payments module and an `awaiting_payment` state | Stripe Connect, a commission, deposit holds |
| Disputes | Reports that you read, plus reviews | A claims process tied to payments | Arbitration and an admin screen |
| Availability | One item per listing, whole days | A units table for quantity | Hourly slots, same-day turnover |
| Acceptance | The owner answers for their whole group | Counter-offers | Instant booking |
| Search | Postgres with PostGIS and full-text search | A read replica | A dedicated search engine |
| Real-time | One channel per user, used as a signal | More event types | Presence, typing indicators, read receipts |
| Web | The same Expo app, server-rendered | A separate public site on the same API | Web push, QR scanning in the browser |
| Verification | Email and phone | An `id_verified_at` field on users | Identity checks for every user |
| Markets | One city | A currency code on every amount | Multi-currency, cross-border owners |

## 10. Project structure

Two apps and one shared package in a pnpm workspace. A package is added only when two consumers need the same code.

```text
gear/
  apps/
    app/                     Expo app: iOS, Android, web
      app/                   Expo Router routes; thin screens only
      features/              listings, search, trips, rentals, chat, handover, account
      components/            buttons, inputs, cards, theme
      lib/                   API client, auth session, query client, realtime
        scanner/             scanner.native.tsx, scanner.web.tsx
    api/                     Hono API and job worker
      src/
        modules/             identity, listings, search, trips, rentals,
                             messaging, handover, notifications, reports
          rentals/           routes.ts, service.ts, state-machine.ts, jobs.ts, rentals.test.ts
        db/                  schema.ts, migrations/, client.ts
        platform/            queue.ts, realtime.ts, storage.ts, push.ts, email.ts
        http/                app.ts, auth.ts, errors.ts, rate-limit.ts
        server.ts            HTTP entry point
        worker.ts            job-only entry point, for when the worker is split out
  packages/
    shared/                  Zod schemas, status enums, event names, money and date helpers
  supabase/                  project config, storage buckets, realtime policy
  .github/workflows/         lint, typecheck, test, migrate, deploy
```

### What belongs where

| Place | Holds | Must not hold |
| --- | --- | --- |
| `apps/app/app` | Route files that compose feature components | Data fetching or business rules |
| `apps/app/features` | Screens, hooks and components for one area | Imports from another feature's internals |
| `apps/app/lib` | The typed API client, auth session, query client and platform wrappers | UI |
| `apps/api/src/modules` | Routes, service functions, queries and jobs for one domain | Queries against another module's tables |
| `apps/api/src/platform` | Thin wrappers around the queue, storage, push and email | Business rules |
| `packages/shared` | Schemas, enums and pure helpers | React, Node APIs or database code |

### Rules that keep coupling low

- **Modules talk through service functions.** `rentals` calls `notifications.notify()` and never touches the `notifications` table. The `search` module is the one exception and may read across tables.
- **Service functions take the transaction as their first argument.** That is the whole dependency-injection story: no repository layer and no container.
- **The app imports API types only.** `import type { AppType }` gives the typed client and cannot pull server code into the bundle.
- **`shared` stays pure.** Code that needs React or Node belongs in an app.
- **Platform splits use file extensions.** `.native.tsx` and `.web.tsx` sit behind one exported interface, in two places only: the scanner and, later, maps.
- **No UI package yet.** There is one client app. Create `packages/ui` when a second one exists.
- **A lint rule enforces the import boundaries,** so the structure does not rest on discipline.
- **Turborepo is optional.** pnpm workspaces are enough until builds get slow.

## Decisions I need from you

Each item below changes the schema or the first screens, so they come before any code.

- [ ] **Your own API or Supabase directly.** This revision keeps the API. Going direct removes the most code, at the cost of lock-in and a later move when payments arrive.
- [ ] **Further simplifications.** Not applied yet: no stored addresses, no notifications table, a timer in place of the job queue, a static web build, a typed code before QR, email-only sign-in, simpler categories and search, a lighter photo pipeline, and two environments.
- [ ] **Launch market.** I assumed Montreal and Canadian users only.
- [ ] **Scope of gear.** Drop cars, and exclude ropes, harnesses, helmets and avalanche gear at launch?
- [ ] **Pending requests block the dates.** The alternative lets owners choose among competing requests.
- [ ] **Whole-day rentals** with no same-day turnover in the MVP?
- [ ] **Team size.** A solo build argues for taking most of the simplifications above.

### Decided so far

- No in-app payments in the MVP. Users pay each other, and the app records it.
- Supabase Realtime stays for live updates.

### What I could not verify

- Whether terms of use are enough to keep you out of disputes between users. That needs a lawyer.
- Server rendering in Expo SDK 58 under production load. It became stable one month ago.
- Network latency between Fly.io in Toronto and Supabase in Montreal.
- The current wording of Apple's and Google's review rules on account deletion and sign-in options.
- Tax and insurance rules, for owners and for you.

Once these are answered, the next step is the detailed schema and the state-machine tests, then step 1 of the build order.

## Sources

- [Expo SDK 58 changelog](https://expo.dev/changelog/sdk-58)
- [Expo: push notification services](https://docs.expo.dev/guides/using-push-notifications-services/)
- [Expo: react-native-maps](https://docs.expo.dev/versions/latest/sdk/map-view/)
- [Expo: EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/)
- [Bank of Canada: criteria for registering payment service providers](https://www.bankofcanada.ca/core-functions/retail-payments-supervision/retail-payments-supervision-supervisory-policies-and-guidelines/criteria-for-registering-payment-service-providers/)
- [Stripe: place a hold on a payment method](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)
- [Stripe: fees for refunded payments](https://support.stripe.com/questions/understanding-fees-for-refunded-payments)
- [Supabase: Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase: Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase: JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Supabase: regions](https://supabase.com/docs/guides/platform/regions)
- [pg-boss: transaction adapters](https://timgit.github.io/pg-boss/api/adapters)
- [Drizzle: PostGIS guide](https://orm.drizzle.team/docs/guides/postgis-geometry-point)
- [Hono: RPC client](https://hono.dev/docs/guides/rpc)
- [NativeWind v5 installation](https://www.nativewind.dev/v5/getting-started/installation)
- [Fly.io regions](https://fly.io/docs/reference/regions)
- [Airbnb: why calendar nights may be blocked](https://www.airbnb.com/help/article/3612)
- [Robert Heaton: the Bumble location vulnerability](https://robertheaton.com/bumble-vulnerability)
- [Robert Heaton: how Tinder keeps your location private](https://robertheaton.com/2018/07/09/how-tinder-keeps-your-location-a-bit-private/)
- [Pen Test Partners: dating apps and trilateration](https://www.pentestpartners.com/security-blog/dating-apps-that-track-users-from-home-to-work-and-everywhere-in-between/)
