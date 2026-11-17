# Step 1: Foundations

**Goal:** a person can sign in on iOS, Android and web, and see and edit their profile, against a local stack. CI runs lint, typecheck and tests. A merge to main deploys staging.

**Depends on:** nothing.

## You do by hand

Claude cannot do these, and should not try:

- Create two Supabase projects in Canada Central: staging and production. Local development uses `supabase start`.
- In Supabase Auth, set up email sending through Resend (SMTP). SMS through Twilio is postponed; when it is added, also turn on phone confirmations. With them off, Auth marks a new phone number as confirmed with no SMS code at all.
- After the first migration on staging and on production, give the `api` role a password: `alter role api with login password '...'`. Put the resulting connection string in Fly as `DATABASE_URL`.
- Create the Fly.io app in Toronto and the EAS project.
- Put secrets in Fly, EAS and GitHub. None go in the repository or in a file on your laptop.

## In scope

- A pnpm workspace laid out as in `00-overview.md`: `apps/app`, `apps/api`, `packages/shared`. TypeScript in strict mode. Exact versions.
- Root scripts named `typecheck`, `test`, `lint` and `format`. Prettier is a root dev dependency. The Claude Code hooks rely on both.
- API skeleton: Hono app, error shape, request id, JSON logs, token verification, `/healthz`.
- Database: Drizzle, the migrations folder, the `postgis` and `btree_gist` extensions, the `users` table.
- App skeleton: Expo Router, sign-in screens, session storage, the typed API client, TanStack Query, the theme file, a profile screen.
- Phone verification by SMS code.
- GitHub Actions: lint, typecheck, test against a local Supabase stack, migrate, deploy to staging.

## Out of scope

- The job queue. It arrives with its first job in step 2.
- Avatar upload. It arrives with file storage in step 2.
- Sentry, alerts and account deletion. They are in step 9.

## Data

`users`: `id` (equal to the Supabase auth user id), `display_name`, `avatar_path`, `phone_verified_at`, rating averages and counts as owner and as renter (filled in step 8), `created_at`.

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `GET /healthz` | Liveness and database check | Anyone |
| `GET /v1/me` | The caller's profile | Signed-in user |
| `PATCH /v1/me` | Edit display name | Signed-in user |
| `POST /v1/me/phone` | Record that the phone number is verified | Signed-in user |

## Rules

- **R1.1** Every `/v1` route requires a valid Supabase access token, except the routes a later spec marks as open to anyone. Without a token the API returns 401 in the error shape.
- **R1.2** The API verifies the token's signature locally against the project's published signing keys, kept in memory. An unknown key id triggers one refetch. There is no call to Supabase per request.
- **R1.3** No flag or environment variable skips verification. Tests hand the verifier their own key set.
- **R1.4** The first authenticated request from a new auth user creates their `users` row. `users.id` equals the auth user id.
- **R1.5** `/v1/me` routes act on the caller only. No route accepts a user id to edit.
- **R1.6** Errors have one shape: `{ code, message, details? }`.
- **R1.7** Request and response bodies have Zod schemas in `packages/shared`. Responses are built from output schemas.
- **R1.8** Every table in the `public` schema has row-level security enabled and no policies. A query made with the publishable key returns nothing.
- **R1.9** Each log line is JSON with a request id and, when known, the user id. Tokens are never logged.
- **R1.10** `/healthz` returns 200 when the database answers and 503 when it does not.
- **R1.11** `phone_verified_at` is set only from Supabase Auth's own record of the confirmation, never from a value the client sends.
- **R1.12** On iOS and Android the session is kept in the device's secure storage.
- **R1.13** The API keeps one pool of about 10 database connections for its whole life. It does not use the transaction-mode pooler.
- **R1.14** A deploy applies the migrations before the new version of the API starts. A failed migration stops the deploy.

## Tests to write first

- Token handling: missing, malformed, expired, wrong signature and wrong issuer each return 401. A valid token returns 200.
- An unknown key id causes exactly one key refetch.
- The first request creates one `users` row. A second request creates none.
- `PATCH /v1/me` changes only the caller's row.
- Catalogue test: every table in `public` has row-level security on and zero policies. This test stays in the suite, so later tables are covered without new code.
- A direct query to Supabase with the publishable key reads no row from `users`.
- The error shape for 401, 404 and a validation failure.
- `/healthz` with the database up and with it unreachable.

## Done when

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass locally and in CI.
- [ ] You have signed in with email, on a phone and on web.
- [ ] You have verified a phone number by SMS and seen `phone_verified_at` set. On the local stack only; on staging this waits for the SMS provider.
- [ ] A merge to main migrates and deploys staging.

## Gaps filled

Confirm or change these before starting.

- **G1.1 How the `users` row is created.** Default: the API creates it on the first authenticated request (R1.4). No trigger on the auth schema.
- **G1.2 How phone verification reaches `users`.** Default: the app runs Supabase Auth's phone verification, then calls `POST /v1/me/phone`. The API reads the confirmation time from Supabase Auth for the caller and copies it. Verified on the local stack: the app calls `updateUser({ phone })`, then `verifyOtp({ phone, token, type: 'phone_change' })`. The API then calls `GET /auth/v1/user` with the caller's own token and copies `phone_confirmed_at`. When Auth has no confirmation, the API returns 409 `phone_not_verified`.
- **G1.3 Which Postgres role the API connects as.** Decided: migrations run as `postgres`, which owns every table. The API connects as a dedicated `api` login role with `BYPASSRLS` and explicit grants per table. It owns nothing. In step 5, `rental_events` becomes append-only by granting `api` only `SELECT` and `INSERT` on it.
- **G1.4 One migration system.** Default: all SQL lives in `apps/api/src/db/migrations`, including storage buckets and the realtime policy. `supabase/` holds only the local stack's `config.toml`. The proposal lists buckets and the realtime policy under `supabase/` without saying how they are applied.
- **G1.5 Placement.** `/healthz` and JSON logging are built here. The proposal lists them under operations without naming a step.
- **G1.7 Sign-in flows.** Decided: email sign-in uses a 6-digit code (`signInWithOtp({ email })`, then `verifyOtp({ type: 'email' })`), with no password and no magic link. Apple and Google sign-in are postponed to a later step. On iOS and Android the session is split across SecureStore keys of under 2 KB each.
- **G1.6 Routes.** The `/v1/me` routes are not in the proposal's endpoint table.
