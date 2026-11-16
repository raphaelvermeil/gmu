# How to build from these specs

One file per build step, in order. `00-overview.md` holds what every step shares.

| File | Step |
| --- | --- |
| `01-foundations.md` | Monorepo, CI, environments, sign-in, profiles |
| `02-listings.md` | Listings, photos, categories, pickup locations, blackout dates |
| `03-search.md` | Nearby search and public listing pages |
| `04-trips.md` | Trips and trip items |
| `05-rentals.md` | Submit, the state machine, availability, expiry |
| `06-notifications-chat.md` | Inbox, push, email, realtime, chat |
| `07-handover.md` | QR tokens, photos, confirmations, one-sided reports |
| `08-trust.md` | Reviews, reports, blocking |
| `09-hardening.md` | Sweeps, rate limits, account deletion, store submission |

## Before a step

Open the file and read "Gaps filled" at the bottom. Each line is something the proposal left open, with a default. Change the file where you disagree. Step 2 has one gap that blocks it.

## Running a step

Use one branch and one fresh Claude Code session per step. These prompts work as written; replace the file name.

1. **Plan.** In plan mode:
   `Read docs/spec/00-overview.md and docs/spec/05-rentals.md. Do not write code. Tell me what is ambiguous or contradictory, then give me a plan.`
2. **Tests first.**
   `Write the tests listed under "Tests to write first". Run them and show me that each fails for the right reason.`
3. **Implement.**
   `Implement until the tests pass. Show me the command and its output.`
4. **Review.**
   `Use the spec-reviewer subagent to review this branch against docs/spec/05-rentals.md.`
5. **Your part.** Read every migration and every ownership check yourself. Do the checks under "Done when" that need a phone.
6. **Merge**, then start the next step in a new session.

When Claude finds a rule the spec does not cover, the answer goes into the spec file first and into the code second.

## What the Claude Code setup does

| File | Effect |
| --- | --- |
| `CLAUDE.md` | Loaded in every session: commands, the rules the code does not show, how to work |
| `.claude/rules/*.md` | Loaded only when Claude reads files under the matching path |
| `.claude/settings.json` | Denies reading `.env` files, and the Supabase CLI commands that link to or push to a hosted project; registers the hooks |
| `.claude/hooks/protect-migrations.mjs` | Blocks an edit to a migration file that is already committed |
| `.claude/hooks/format.mjs` | Runs Prettier on each file Claude edits |
| `.claude/hooks/typecheck.mjs` | Stops Claude from ending its turn while `pnpm typecheck` fails |
| `.claude/agents/spec-reviewer.md` | A reviewer with no edit tools that checks a branch against a spec file |

The hooks need three things from the repository, all set up in step 1: a git repository, a root `typecheck` script, and Prettier as a root dev dependency. Until those exist the hooks do nothing.
