# Shinetime — Development Guide

## Architecture

Cloud-backed via **Supabase**. No local server, tunnel, or LAN setup.

- The Expo app reads/writes Supabase directly (`src/lib/supabase.js`).
- Jobs are cached in AsyncStorage and synced in the background (`src/services/storage.js`).
- Tenant isolation (per dealership) is enforced by Postgres **Row-Level Security**,
  not by client code — the anon key is public, so RLS is the real boundary.
- OCR and any other privileged work run in **Edge Functions**, never in the app.

## Quick Start

1. Install Node 20+ and the Expo Go app.
2. Add repo-root `.env`:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-ref.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   ```
3. `npm install && npm start`, then scan the QR code.

For a fresh Supabase project: apply `supabase/migrations/*.sql`, deploy the
functions in `supabase/functions/`, set the `GEMINI_API_KEY` secret, and create a
dealership + membership.

## File Structure

```
App.js                          # Auth-gated entry (session → dealership → role → PIN)
src/
├── lib/supabase.js             # Supabase client (AsyncStorage-backed session)
├── context/AuthContext.js      # Session, profile, memberships, active dealership/role
├── services/
│   ├── storage.js              # Jobs CRUD + Supabase sync + pending-write queue
│   ├── ocr.js                  # Calls the ocr-vehicle Edge Function
│   └── timeMath.js             # Pure duration helpers (unit-tested)
├── navigation/AppNavigator.js  # Home / NewJob / InProgress / History / JobDetail
└── screens/                    # incl. onboarding drafts (CreateDealership, JoinByCode,
                                # ManageInviteCodes) — not yet wired into AppNavigator
supabase/
├── migrations/                 # 001 foundation, 002 storage, 003 hardening (draft),
│                               # 004 onboarding (draft)
└── functions/ocr-vehicle, manager-dashboard
__tests__/                      # node --test suites
```

## Data Flow

- **Auth**: `AuthContext` restores the session, ensures a `profiles` row, loads
  `dealership_memberships`, and drives the entry gate in `App.js`.
- **Jobs**: created locally first (`createJob`), then synced. All local
  read-modify-writes go through a mutex (`mutateLocalJobs`) so concurrent actions
  and background syncs can't clobber each other. Failed writes queue in
  `@detailtracker_pending_jobs` and replay on the next sync.
- **Photos**: uploaded to the private `job-photos` bucket; the DB row is written
  first, then a short-lived signed URL is minted at read time.
- **OCR**: `scanVehicleFromImage` → `supabase.functions.invoke('ocr-vehicle')`.

## Key Functions (`src/services/storage.js`)

```javascript
await createJob({ stockNumber, make, model, year, color })
await getActiveJobs()      // syncs, returns in_progress
await pauseJob(jobId, note)
await resumeJob(jobId)
await completeJob(jobId)
await addJobNote(jobId, text)
await addJobPhoto(jobId, { base64, mimeType, note })
await getAllJobs()         // full history (syncs first)
await getOverallStats()
```

Duration math lives in `src/services/timeMath.js` (clamps negatives to guard
against device clock skew) and is unit-tested — run `npm test`.

## Backend Notes

- Migrations `003` (server-side PIN identity + RLS tightening) and `004`
  (self-serve onboarding: invite codes + RPCs) are **drafted but not applied**.
  See `docs/PHASE1_HARDENING_NOTES.md` and `docs/PHASE2_ONBOARDING_NOTES.md`.
- The current detailer-PIN flow (`AuthContext.completeDealershipUserAccess`) is
  per-device only; migration `003` moves it server-side. Wiring is a follow-up.

## Testing

- `npm test` — unit tests (currently time-math).
- Device smoke test: sign in → start → pause → resume → note → photo → complete,
  then repeat offline and reconnect to verify sync/merge.

## Common Issues

- **"Supabase env vars missing"** — no `.env`; add it and `npx expo start -c`.
- **Empty data after sign-in** — account has no active membership, or RLS
  migrations aren't applied.
- **Timer/UI stale** — screens reload on focus (`useFocusEffect`); pull data via
  the `storage.js` getters, which sync first.

## Getting Help

- Expo: https://docs.expo.dev
- React Navigation: https://reactnavigation.org
- Supabase: https://supabase.com/docs
