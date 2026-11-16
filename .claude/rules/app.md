---
paths:
  - "apps/app/**/*.{ts,tsx}"
---

# App rules

- Files under `app/` are routes. They compose feature components and hold no data fetching and no business rules.
- A feature folder does not import another feature's internals.
- Server state lives in TanStack Query. No Redux, Zustand or other global store.
- Every call to the API goes through the typed client in `lib/`. Import API types with `import type` only.
- The app talks to Supabase directly for three things: sign-in, uploads to signed URLs, and the one realtime subscription. Never query a table from the app.
- A realtime event carries ids. React by invalidating the matching query. Also refetch on focus and on reconnect.
- Styling is `StyleSheet` plus the theme file. No styling library.
- Platform splits use `.native.tsx` and `.web.tsx` behind one interface, and only for the scanner.
- Every screen handles its loading, empty and error states.
- Check a screen in the web build before calling it done, and say when a change needs testing on a phone.
