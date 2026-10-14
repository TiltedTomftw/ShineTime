# Shinetime — Development Guide

## Architecture

Cloud-backed via **Supabase**. No local server, tunnel, or LAN setup.

- **Supabase is the source of truth for jobs.** Screens read from it; the phone
  keeps no job list of its own.
- The phone keeps only an **outbox** of actions that haven't been confirmed yet
  ("paused #P4521 at 10:42") plus not-yet-uploaded photo files. Each entry is
  deleted the moment Supabase confirms it, and sign-out clears it.
- Tenant isolation (per dealership) is enforced by Postgres **Row-Level Security**,
  not by client code — the anon key is public, so RLS is the real boundary.
- OCR, employee sign-in and other privileged work run in **Edge Functions**,
  never in the app.

## Quick Start

1. Install Node 20+ and the Expo Go app.
2. Add repo-root `.env`:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-ref.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   # optional: where the manager "Open the web dashboard" button points
   EXPO_PUBLIC_DASHBOARD_URL=https://tiltedtomftw.github.io/shinetime-dashboard/
   ```
3. `npm install && npm start`, then scan the QR code.

For a fresh Supabase project: apply `supabase/migrations/*.sql`, deploy the
functions in `supabase/functions/` (set `GEMINI_API_KEY` and
`EMPLOYEE_PIN_PEPPER`), then `node scripts/create-dealership.js`.

## File Structure

```
App.js                          # Gate: session → account → dealership → app
src/
├── lib/supabase.js             # Supabase client (+ AppState token refresh)
├── context/AuthContext.js      # Session, profile, memberships, active dealership/role
├── services/
│   ├── jobLogic.js             # PURE: applyJobAction reducer, row mapping, timers (CJS, tested)
│   ├── timeMath.js             # PURE: durations + time formatting (CJS, tested)
│   ├── outboxCore.js           # PURE: the outbox rules (CJS, tested)
│   ├── outbox.js               # Outbox wiring: AsyncStorage, NetInfo, AppState, retries
│   ├── jobSync.js              # Sends one outbox entry to Supabase
│   ├── jobs.js                 # Reads + actions for screens; photo prep; legacy cleanup
│   ├── session.js              # In-memory "who/where" for the services
│   └── ocr.js                  # Calls the ocr-vehicle Edge Function
├── components/                 # ui.js (Button, Card, Field, StatusPill…), JobCard,
│                               # OutboxBanner, Sheet, PhotoViewer, AuthLayout
├── navigation/AppNavigator.js  # Home / NewJob / JobDetail / History / Account
└── screens/
supabase/
├── migrations/
└── functions/ocr-vehicle, employee-access, manager-dashboard (legacy)
dashboard/index.html            # Manager web dashboard (GitHub Pages)
__tests__/                      # node --test (pure) + jest (components) + integration
```

## Data Flow

- **Auth**: `AuthContext` restores the session, ensures a `profiles` row, loads
  `dealership_memberships`, and drives the gate in `App.js`. If loading fails
  (no signal) the gate shows a Retry screen rather than guessing.
- **Employees** sign in through the `employee-access` function with a code,
  their name and a PIN. "I'm new here" confirms a new name before creating an
  account; "I've signed in before" accepts any code from their dealership,
  even an expired one.
- **Actions** (`create`, `pause`, `resume`, `complete`, `note`, `photo`) are
  built by `jobs.js`, applied locally with `applyJobAction` for an instant UI,
  written to the outbox, and sent straight away. `jobSync.js` re-reads the job,
  applies the same action to the server copy and saves with an
  optimistic-concurrency check on `client_updated_at`. Action ids make retries
  idempotent; action timestamps are when the detailer tapped.
- **Reads**: `fetchOpenJobs`, `fetchJob`, `fetchHistory` (paged),
  `fetchTodayStats` — always the signed-in person's own jobs. The app has no
  manager mode; manager tools are only on the web dashboard. Unsent outbox actions are overlaid so a detailer always sees
  their latest taps. A small in-memory cache (never written to disk) keeps
  screens usable if the signal drops mid-shift.
- **Photos**: resized to 1600px, kept in app storage until uploaded to the
  private `job-photos` bucket, recorded in `job_photos`, and read back with one
  batched `createSignedUrls` call. Payloads store only `storagePath`.
- **Rework**: a manager reopening a job adds a pause starting at the original
  completion time, so the wait before rework isn't billed. `needs_rework` is an
  open status everywhere.

## Testing

- `npm test` — pure unit tests (reducer, outbox rules, time math).
- `npm run test:components` — jest render tests for the main screens.
- `node --test __tests__/integration/dashboard.integration.js` — dashboard in
  jsdom with a fake Supabase (no network).
- `npm run test:integration` — live Supabase project (throwaway data).

## Common Issues

- **"Supabase env vars missing"** — no `.env`; add it and `npx expo start -c`.
- **"Can't reach Shinetime"** on launch — the account couldn't be loaded; check
  the network. Unsent work stays in the outbox until it sends.
- **Empty data after sign-in** — the account has no active membership (No Access
  screen), or RLS migrations aren't applied.
