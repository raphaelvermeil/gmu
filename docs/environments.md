# Environments and settings

Every setting the project uses: where it lives and how to change it. **Names only, never values.** Secrets live only in the service that uses them. Nobody, including CI, keeps a copy in a file.

## Environments

| Environment | Database and Auth                                        | API                                                           | Web                                                              | Deployed by                 |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| Local       | `supabase start` on your machine                         | `node src/server.ts` on port 8787                             | `expo start`                                                     | you                         |
| Staging     | Supabase project `lawqgrupmrxrimemijvs` (Canada Central) | Fly app `gear-api-staging` → https://gear-api-staging.fly.dev | EAS Hosting alias `staging` → https://gmu-gear--staging.expo.app | CI, on every push to `main` |
| Production  | not created yet                                          | not created yet                                               | not created yet                                                  | by hand, for now            |

## Local

Nothing here is secret. `supabase start` gives every developer the same values.

- `apps/app/.env.local`: copy `apps/app/.env.example`. To use Expo Go on a phone, replace `127.0.0.1` with your laptop's LAN address.
- API: run it with these environment variables (see `CLAUDE.md` for the commands):
  - `DATABASE_URL=postgresql://api:api@127.0.0.1:54322/postgres`
  - `SUPABASE_URL=http://127.0.0.1:54321`
  - the local publishable key from `.env.example`
  - `CORS_ORIGINS=http://localhost:8081`
- `pnpm --filter ./apps/api db:local` migrates the local database and gives the local `api` role its login.
- The phone test number is set in `supabase/config.toml`: `+15145550100`, code `123456`.

## Staging

### GitHub: repository `raphaelvermeil/gmu`, environment `staging`

| Name                         | Kind     | Secret  | What it is                                                              | How to create or rotate it                                                                                                                                      |
| ---------------------------- | -------- | ------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGING_DATABASE_OWNER_URL` | secret   | **yes** | Session-pooler URL for the `postgres` user. CI runs migrations with it. | Supabase → Connect → Direct → Session pooler. To rotate: reset the database password in Supabase, then `gh secret set STAGING_DATABASE_OWNER_URL --env staging` |
| `FLY_API_TOKEN`              | secret   | **yes** | Deploy token, limited to `gear-api-staging`                             | `fly tokens create deploy --app gear-api-staging`, then `gh secret set FLY_API_TOKEN --env staging`                                                             |
| `EXPO_TOKEN`                 | secret   | **yes** | Expo access token for the web deploy                                    | expo.dev → Settings → Access tokens, then `gh secret set EXPO_TOKEN --env staging`                                                                              |
| `FLY_APP_STAGING`            | variable | no      | `gear-api-staging`                                                      | `gh variable set FLY_APP_STAGING --env staging`                                                                                                                 |

### Fly: app `gear-api-staging`

| Name                       | Secret  | What it is                                                                                                                                              |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | **yes** | Direct connection as the `api` role: `postgresql://api:<password>@db.<ref>.supabase.co:5432/postgres`. The pooler form did not work for the `api` role. |
| `SUPABASE_URL`             | no      | `https://<ref>.supabase.co`, with no trailing slash                                                                                                     |
| `SUPABASE_PUBLISHABLE_KEY` | no      | `sb_publishable_…`                                                                                                                                      |
| `CORS_ORIGINS`             | no      | Comma-separated origins: the staging web URL and `http://localhost:8081`                                                                                |

To change one: `fly secrets set --app gear-api-staging NAME=value`, or `fly secrets import`, which reads from standard input. Setting a secret restarts the API. `fly secrets list` shows names only.

To rotate the `api` password: in the Supabase SQL Editor, run `alter role api with password '<new>';`, then update `DATABASE_URL`.

### EAS: project `@raphaelvermeil/gear`, environment `preview`

| Name                                   | Secret | Value                              |
| -------------------------------------- | ------ | ---------------------------------- |
| `EXPO_PUBLIC_API_URL`                  | no     | `https://gear-api-staging.fly.dev` |
| `EXPO_PUBLIC_SUPABASE_URL`             | no     | `https://<ref>.supabase.co`        |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no     | `sb_publishable_…`                 |

`EXPO_PUBLIC_*` values ship inside the app, so they must never be secret. Change them with `eas env:set preview --name NAME --value VALUE`. A deploy must pass `--environment preview`, because the server-rendered pages read these values at request time.

### Supabase dashboard (staging project)

| Setting                                                                           | Secret                       | Where                                                  |
| --------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| Custom SMTP through Resend (`smtp.resend.com:465`, user `resend`)                 | **yes** (the Resend API key) | Authentication → Emails → SMTP Settings                |
| Email templates "Confirm signup" and "Magic link" show the 6-digit `{{ .Token }}` | no                           | Authentication → Emails → Templates                    |
| Email OTP length 6                                                                | no                           | Authentication → Sign In / Providers → Email           |
| Signing key ES256 (the API rejects HS256)                                         | no                           | Project Settings → JWT Keys                            |
| `api` role password                                                               | **yes**                      | Set once with `alter role api with login password '…'` |

## Postponed

See "Postponed until the owner says so" in `docs/spec/00-overview.md`.

- **SMS through Twilio.** When it is set up: add the Account SID, Auth Token and Messaging Service SID in Authentication → Sign In / Providers → Phone, and turn on **phone confirmations**.
- **Apple and Google sign-in.** OAuth clients, plus redirect URLs under Authentication → URL Configuration.
- **Production.** Same layout as staging, with its own project, app, keys and passwords. Never reuse a staging secret.

## Sharing with another developer

- **For local work,** they need nothing beyond the repo.
- **To deploy or change settings,** give them access to the services themselves: GitHub collaborator, Fly organization member, Expo account member, Supabase organization member.
- **The few passwords you keep** (database owner, `api` role, Resend key) belong in a shared password-manager vault, never in chat or a file.
