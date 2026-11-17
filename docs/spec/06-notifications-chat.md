# Step 6: Notifications and chat

**Goal:** both people hear about every change to a rental, in the app, by push and by email, and they can talk to each other before and during a rental.

**Depends on:** step 5. Chat depends only on users, so it can be built earlier if you want testers talking.

## In scope

- The `notifications` table and the single `notify()` function.
- Push through Expo, email through Twilio SendGrid, with delivery jobs.
- Realtime events on one private channel per user.
- Conversations and messages.
- Calls to `notify()`, realtime and system messages added inside `transitionRental` from step 5.
- Reminder jobs before pickup and before return.

## Out of scope

- Typing indicators, read receipts, presence, web push.
- Photos or attachments in chat.
- Blocking (step 8).

## Data

| Table | Fields | Notes |
| --- | --- | --- |
| `notifications` | `user_id`, `type`, `payload`, `rental_id`, `read_at`, `created_at` | The inbox |
| `push_tokens` | `user_id`, `expo_token`, `platform`, `last_seen_at` | The token is unique |
| `conversations` | `user_low_id`, `user_high_id`, `last_message_at`, one read marker per member | Unique on the pair, with `user_low_id < user_high_id` |
| `messages` | `conversation_id`, `sender_id`, `kind`, `body`, `rental_id`, `listing_id`, `created_at` | `kind` is `text` or `system` |

## API

| Endpoint | Purpose | Who |
| --- | --- | --- |
| `GET /v1/notifications` | The inbox, newest first | Signed-in user |
| `POST /v1/notifications/read` | Mark notifications read | Signed-in user |
| `POST /v1/push-tokens`, `DELETE /v1/push-tokens/:token` | Register and remove a device | Signed-in user |
| `GET /v1/conversations` | The caller's conversations | Signed-in user |
| `POST /v1/conversations` | Get or create the conversation with another user | Signed-in user |
| `GET`, `POST /v1/conversations/:id/messages` | Read and send | Member of the pair |
| `POST /v1/conversations/:id/read` | Move the caller's read marker | Member of the pair |

## Rules

Notifications:

- **R6.1** `notifications.notify(tx, userId, type, payload)` is the only way to create a notification. Inside the caller's transaction it inserts the row, enqueues the delivery jobs and emits `notification.created`.
- **R6.2** Other modules call `notify()`. They never write the `notifications` table.
- **R6.3** Every rental transition notifies the other party and emits `rental.updated` to both, inside the transition's transaction. A rolled-back transition leaves no notification, no job and no event.
- **R6.4** iOS and Android get push. Web gets the inbox and email.
- **R6.5** A push or an email carries ids and one short line of text. It never carries an address.
- **R6.6** Delivery jobs retry with backoff. A push token that Expo reports as invalid is deleted.
- **R6.7** Reminder jobs notify both people before pickup and before return.

Realtime:

- **R6.8** Events are sent with Supabase's `realtime.send()` to the private topic `user:<id>`, from inside the transaction.
- **R6.9** The event names live in `packages/shared`: `rental.updated`, `trip.updated`, `message.created`, `notification.created`. A payload carries ids only.
- **R6.10** A user can subscribe to their own channel and to no other.
- **R6.11** The app holds one subscription and maps each event to a query invalidation. It also refetches on focus and on reconnect. Every screen works with Realtime switched off.

Chat:

- **R6.12** There is one conversation per pair of users, enforced by the unique constraint. Creating it twice returns the same row.
- **R6.13** Only the two members can read or post. Anyone else gets 403.
- **R6.14** Posting a message is one transaction: insert the message, update `last_message_at`, notify the recipient, emit `message.created`.
- **R6.15** A message can carry a `listing_id` or a `rental_id` as context. A conversation can start from a listing before any request exists.
- **R6.16** Each rental transition inserts a `system` message into the pair's conversation, such as "Request sent for Tent, 3 to 5 July", creating the conversation if needed.
- **R6.17** A thread pages by a `(created_at, id)` cursor, newest first. Unread counts are computed from the read markers.
- **R6.18** A message for a conversation that is open on screen shows no banner. The app suppresses it.
- **R6.19** Indexes: `messages (conversation_id, created_at desc, id)`; `conversations (user_low_id, last_message_at desc)` and the same for `user_high_id`; `notifications (user_id, created_at desc)` plus a partial index on unread.

## Tests to write first

- `notify()` inside a transaction that rolls back leaves no row and no job.
- For each transition in the step 5 table, the right person receives a notification of the right type, and both receive `rental.updated`.
- A third user gets 403 reading and posting in a conversation.
- Two requests that create the same pair at the same time end with one conversation.
- Channel access: user A cannot subscribe to `user:B`. Run this against the local Supabase stack.
- Payloads: no realtime payload, push or email contains an address or a coordinate, and realtime payloads contain ids only.
- Delivery: a failed send is retried. A token reported invalid is deleted. Fake the Expo and SendGrid HTTP calls, not the database.
- Thread paging returns every message once.
- A transition writes its system message in the same transaction as the status change.

## Done when

- [ ] The tests above pass, with the command and output shown.
- [ ] Two phones: a request, an accept and a chat message each arrive as a push on the other phone and update the open screen without a manual refresh.
- [ ] With Realtime disabled in the app, the same flow still works after pulling to refresh.

## Gaps filled

- **G6.1 Which notifications send email.** The proposal does not say. Default: every rental event sends email. A chat message sends email only when the recipient has no push token.
- **G6.2 The list of notification types.** Default: request received, request accepted, request declined, request expired, rental cancelled, pickup reminder, return reminder, new message. Steps 7 and 8 add their own.
- **G6.3 When a reminder fires.** The proposal says 24 hours before, but rentals have dates and no times. Default: 09:00 local time on the day before.
- **G6.4 Message limits.** Default: text only, 2,000 characters.
- **G6.5 What a message push shows.** Default: the sender's name and no message text.
- **G6.6 Exact Supabase calls.** Read the current Supabase docs for `realtime.send()` and for private channel authorization before writing them. Do not rely on memory.
- **G6.7 Routes.** Marking notifications read, removing a push token, creating a conversation and moving the read marker are not in the proposal's endpoint table.
