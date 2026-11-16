---
paths:
  - "apps/api/**/*.ts"
---

# API rules

- One folder per module under `src/modules`, with `routes.ts`, `service.ts`, `jobs.ts` and tests beside the code.
- A module reads and writes its own tables. To reach another module's data, call its service function. `search` is the one exception and may read across tables.
- Every route validates its input with a Zod schema from `packages/shared` and builds its response from an output schema. Never return a database row as it is.
- State changes are commands: `POST /resource/:id/verb`. There is no generic status update.
- One transaction per state change: status, event row, notifications, jobs and the realtime event together.
- Errors use the shared shape `{ code, message, details? }`. A booking conflict is a 409 that names the listings.
- 401 means no valid token. 403 means not this caller's resource. 409 means the wrong state.
- Never log an address, an exact coordinate, a token, a handover code or a message body.
- Thin wrappers for the queue, storage, push and email live in `src/platform` and hold no business rules.
- In tests, fake the HTTP calls to outside services (Expo, Resend). Do not fake the database or `transitionRental()`.
