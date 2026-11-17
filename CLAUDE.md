# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working principles

- **Simplest possible implementation, always.** Prefer the most straightforward solution that works. No speculative abstraction, no gold-plating.
- **Robust, but simple first.** The simple version must still be correct and reliable — simple does not mean fragile.
- **Ask before implementing edge cases.** Build the core happy path, then stop and ask before adding handling for edge cases, error branches, or extra scenarios.
- **Least amount of changes possible.** Make the smallest diff that accomplishes the task. Don't refactor, rename, or touch unrelated code unless asked.



# Gear rental marketplace

Peer-to-peer outdoor gear rental: one Expo app (iOS, Android, web), one Hono API, one Postgres database on Supabase.

The spec is in `docs/spec/`. Read `docs/spec/00-overview.md`, then the file for the step you are working on.

## Commands

- Install: `pnpm install`
- Local database, auth and storage: `supabase start`
- Typecheck everything: `pnpm typecheck`
- Lint: `pnpm lint`
- All tests: `pnpm test`
- API tests: `pnpm --filter ./apps/api test`
- One test file: `pnpm --filter ./apps/api exec vitest run src/modules/rentals/rentals.test.ts`
- App in the browser: `pnpm --filter ./apps/app exec expo start --web`

## Rules the code does not show

- No in-app payments. Never add a payment provider, or code that holds, moves or refunds money.
- Only `transitionRental()` writes `rentals.status`.
- Public queries and responses use `public_point`. `address` and `exact_point` leave the API through two routes only: the owner's own pickup locations, and `pickup-details`. They never go into logs, push, email or realtime payloads.
- Every handler that touches a rental, trip, conversation or a listing write starts with an ownership check.
- Migrations are forward-only SQL. Never edit a committed one. Add a new file.
- No repository layer, no DI container, no base classes. Service functions take the transaction as their first argument.
- No new dependency and no new package without asking first.
- Tests run against the local Postgres. Never mock the database.
- Work against the local Supabase stack only. Never run a command against a hosted project. Exception: during environment setup, Claude may run commands against the staging Supabase project, the staging Fly app, GitHub and EAS. Never production.

## How to work

- One build step at a time, on its own branch. Do not start the next step.
- Write the tests listed in the step's spec first. Run them and see them fail. Then implement.
- If the spec is silent or contradicts itself, stop and ask. Do not invent product rules.
- Expo SDK 58, Drizzle 0.45, Hono, pg-boss and Supabase change often. Check their current docs before using an API. Do not rely on memory.
- When you say something works, show the command you ran and its output.
- After a change to a migration or an ownership check, name the file in your summary so it gets read.
