# Overview

Read this before any step. It holds what every step shares. Each numbered file holds one build step.

The product is peer-to-peer outdoor gear rental for one city. People list gear, others rent it for whole days, and the two meet in person to hand it over and settle the money between themselves. It is one Expo app (iOS, Android, web), one Hono API and one Postgres database on Supabase.

Source: the architecture proposal, revision 41, 15 November 2026, saved as `docs/architecture-proposal.md`. When a spec file and the proposal disagree, the spec file wins, because it is the one that gets updated.

## Words

| Word | Meaning |
| --- | --- |
| Trip | A renter's wish list for a set of dates. It reserves nothing. |
| Rental | One renter, one owner, one date range, one pickup, one return. The unit of the product. |
| Rental item | One listing inside a rental, with its title and price frozen at submit. |
| Availability block | A date range on which a listing is taken: an owner blackout or a rental. |
| Handover | The in-person pickup or return, confirmed by a scan. |
| Public point | A pickup location snapped to a grid of about 1 km. The only location the public sees. |
| Operator | The person running the marketplace. Works in the Supabase dashboard. There is no admin role. |

## Invariants

Every step keeps these true. A change that breaks one is wrong even when its tests pass.

1. **No money.** The app never holds, moves or refunds money, and there is no payment provider. It records what the two users confirm.
2. **Location.** `address` and `exact_point` are returned by two routes only: the owner's own pickup locations, and `pickup-details` for a participant of a confirmed or active rental. Every public filter, sort and distance uses `public_point`. No address or exact coordinate appears in logs, analytics, push, email or realtime payloads.
3. **No double booking.** The exclusion constraint on `availability_blocks` is the guarantee. Checks in application code are a courtesy to the user.
4. **One writer for rental status.** Only `transitionRental(tx, rentalId, event, actor)` writes `rentals.status`. It writes the `rental_events` row in the same transaction.
5. **No automatic confirmation.** An owner accepts each request.
6. **Authorization by resource.** Every handler that touches a rental, trip, conversation or a listing write starts with an ownership check. All ids are UUIDs.
7. **One door to the data.** Clients reach business data through the API only. Row-level security is on, with no policies, for every app table. The app holds only the publishable key.
8. **One transaction per state change.** Status, event row, notification rows, jobs and the realtime event commit together or not at all.
9. **Units.** Money is integer cents with a currency code. Rental dates are calendar dates at the pickup location, never timestamps.

## Stack

| Layer | Pick |
| --- | --- |
| App | Expo SDK 58, Expo Router, React Native Web, TypeScript |
| Client data and forms | TanStack Query, Zod, React Hook Form. No global store. |
| Styling | React Native StyleSheet, one theme file, our own components |
| API | Node.js, Hono, Zod validation, REST-style JSON, Hono's `hc` typed client |
| Database | PostgreSQL with PostGIS and btree_gist, on Supabase in Canada Central |
| Data access | Drizzle ORM 0.45 (not the 1.0 release candidate), SQL migrations, raw SQL for geo queries and constraints |
| Auth | Supabase Auth: email sign-in (Apple and Google later); an SMS code through Twilio for phone verification |
| Files | Supabase Storage: a public bucket for listing photos, a private bucket for handover photos |
| Live updates | Supabase Realtime Broadcast, one private channel per user, used only as a "refetch" signal |
| Notifications | Expo Push for iOS and Android, Twilio SendGrid for email, the `notifications` table as the inbox |
| Jobs | pg-boss in the same Postgres. The worker runs inside the API process. |
| Hosting | API on Fly.io in Toronto. Web on EAS Hosting. Mobile through EAS Build, Submit and Update. |
| Monitoring | Sentry, structured JSON logs, an uptime check |

Pin exact versions. Not used: Redis, a server-side cache, a search engine, tRPC, GraphQL, NativeWind, a second web codebase, any payment provider.

## API conventions

- The base path is `/v1`, with JSON in and out. Every request and response body has a Zod schema in `packages/shared`.
- State changes are commands: `POST /resource/:id/verb`. There is no generic status update.
- Lists use cursor pagination: `?cursor=...&limit=...`, returning `next_cursor`. No page numbers and no unbounded lists.
- Errors share one shape: `{ code, message, details? }` with a stable `code`. A booking conflict is a 409 that names the conflicting listings.
- Responses are built from explicit output schemas. A new column is not exposed until a schema names it.
- A repeated command returns the first result. Retries need no extra machinery.
- 401 means no valid token. 403 means the caller is not allowed to touch this resource. 409 means the resource is in the wrong state.

## Project layout

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
  supabase/                  local stack config
  docs/spec/                 this folder
  .github/workflows/         lint, typecheck, test, migrate, deploy
```

- A module reads and writes its own tables. To reach another module's data it calls that module's service function. `search` is the one exception and may read across tables.
- Service functions take the transaction as their first argument. There is no repository layer and no container.
- The app imports API types only (`import type`).
- `packages/shared` holds no React, Node or database code.

## Not in the MVP

Do not build these, even partly, unless a spec file asks for them:

- Payments of any kind, deposit holds, a commission
- A map view
- Per-item acceptance, counter-offers, instant booking
- Quantities above one per listing, hourly rentals, same-day turnover
- Typing indicators, read receipts, presence, web push
- QR scanning in the browser
- An admin screen, an admin role, admin routes
- Identity document checks
- A second currency or a second city

## Decisions still open

These specs use the assumption in the middle column. If a decision changes, edit the files in the last column before building them.

| Decision | Assumed here | Files to edit |
| --- | --- | --- |
| Own API or Supabase directly | Own API | All |
| Store exact addresses at all | Stored, behind one gated route | 02, 05 |
| Keep a `notifications` table | Kept | 06 |
| pg-boss or one scheduled function | pg-boss | 02, 05, 06, 07, 08 |
| Server-rendered or static web build | Server-rendered | 01, 03 |
| QR code or typed code only | QR with a typed code as fallback | 07 |
| Sign-in methods | Email now; Apple and Google later | 01 |
| Categories and search depth | Two-level categories, size attributes, keyword search, pagination | 02, 03 |
| Photo pipeline | Resize in the app, verify in a worker job | 02, 07 |
| Environments | Local, staging, production | 01 |
| Launch market | Montreal, Canadian users, CAD, `America/Toronto` | 03, 05 |
| Scope of gear | No cars. No ropes, harnesses, helmets or avalanche gear. | 02 |
| Pending requests block the dates | Yes | 05 |
| Whole-day rentals, no same-day turnover | Yes | 03, 05 |

## How each step file is laid out

- **Rules** are numbered (`R5.3`) so tests and reviews can cite them.
- **Tests to write first** come before any implementation.
- **Gaps filled** lists what the proposal left open, with the default the spec uses. Treat a default as the spec. If you need a rule that is in neither place, stop and ask.
