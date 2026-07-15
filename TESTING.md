# Testing Shinetime

The app talks directly to Supabase — there is no local server to start.

## Prerequisites

- Repo-root `.env` with `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- The Supabase project has the migrations applied and at least one dealership +
  user membership.

## Unit tests

```bash
npm test        # node --test — currently the time-math suite
```

## Running the app

```bash
npm install
npm start       # scan the QR code with Expo Go
# or npm run android / npm run ios / npm run web
```

Web (`npm run web`) is fine for UI, but the camera/OCR flow needs a real device.

## Manual smoke test (do this on a device before trusting a build)

1. **Auth** — sign in; confirm you land on the dealership → role → PIN gate and
   into Home.
2. **Create** — Start New Job; scan a keytag (or type a stock number); confirm
   OCR auto-fills; Begin Detailing.
3. **Timing** — Pause, wait, Resume, Complete; confirm active time excludes the
   pause and is never negative.
4. **Notes & photos** — add a note and a photo; reopen the job and confirm both
   render (photo via a fresh signed URL).
5. **Offline** — enable airplane mode; create/complete a job; re-enable network;
   confirm it syncs (check the pending-queue replays and nothing is lost).
6. **Concurrency** — on a shared tablet, pause a job while another action/refresh
   runs; confirm neither change is lost (this exercises the write mutex).
7. **Dashboard** — open the manager dashboard URL, sign in, confirm the job and
   stats appear (set the date filter to **All Time**).

## What to watch for

- **Duplicate stock numbers**: a second active job with the same stock number is
  rejected server-side (one-active-job-per-stock). It stays local and is not
  retried forever — expect it to surface, not silently vanish.
- **Cross-device users**: detailer PINs are currently per-device; a user created
  on one tablet won't exist on another until server-side identity (migration 003)
  is wired.

## Troubleshooting

- **"Supabase env vars missing"** — add `.env`, then `npx expo start -c`.
- **No data after sign-in** — the account has no active dealership membership, or
  RLS migrations aren't applied to the project.
- **OCR errors** — the `ocr-vehicle` function isn't deployed or `GEMINI_API_KEY`
  isn't set as a function secret.
- **App crashes / stale bundle** — `npx expo start --clear`.
