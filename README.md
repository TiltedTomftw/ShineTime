# Shinetime

Mobile app for tracking vehicle detailing productivity at car dealerships.

## Architecture

**Cloud-backed via Supabase. No local server to run.**

- **Mobile App**: React Native + Expo. Talks directly to Supabase; caches jobs
  locally (AsyncStorage) and syncs in the background.
- **Backend**: Supabase — Postgres (with Row-Level Security for per-dealership
  tenant isolation), Auth (email/password), Storage (private `job-photos`
  bucket), and Edge Functions.
- **OCR**: `ocr-vehicle` Edge Function (calls Gemini server-side; the API key
  never ships in the app).
- **Manager Dashboard**: a static page hosted on GitHub Pages that reads from
  Supabase directly.

There is no PC server, no tunnel, and nothing to start on a local network — the
app is self-contained and points at a Supabase project via `.env`.

## Project Structure

```
Shinetime/
├── App.js                     # Entry + auth-gated navigation
├── src/
│   ├── screens/               # Home, NewJob, InProgress, History, JobDetail,
│   │                          # Auth, DealershipSelect, RoleSelection, UserPin,
│   │                          # CreateDealership, JoinByCode, ManageInviteCodes
│   ├── navigation/            # React Navigation stack
│   ├── context/AuthContext.js # Session, memberships, active dealership/role
│   ├── services/              # storage.js (jobs/sync), ocr.js, timeMath.js
│   └── lib/supabase.js        # Supabase client
├── supabase/
│   ├── migrations/            # SQL schema (001 foundation … 004 onboarding)
│   └── functions/             # ocr-vehicle, manager-dashboard
├── web-dashboard/             # Improved static manager dashboard (see its README)
└── docs/                      # Migration plans, edge-function + RLS notes
```

## Setup

### 1. Configure Supabase credentials

Create a `.env` in the repo root (gitignored):

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
```

The anon/publishable key is safe to ship in the app — **Row-Level Security is the
security boundary**, so the SQL policies in `supabase/migrations/` must be applied
to the project.

### 2. Run the app

```bash
npm install
npm start           # then scan the QR code with Expo Go
# or: npm run android / npm run ios / npm run web
```

### 3. Backend (one-time, per Supabase project)

- Apply the migrations in `supabase/migrations/` (Supabase SQL editor or
  `supabase db push`).
- Deploy the OCR function (see `docs/SUPABASE_OCR_EDGE_FUNCTION.md`) and set its
  `GEMINI_API_KEY` secret.
- Create a dealership + a user membership (self-serve onboarding is drafted in
  migration `004`; until wired, seed via the Supabase dashboard).

## Usage

**Detailers**: sign in → pick dealership → pick role → start a job (scan the
keytag or type the stock number) → Pause/Resume as needed → Complete.

**Managers**: open the dashboard URL and sign in to see live jobs, per-detailer
detail times, notes, and photos.

## Features

- Start / Pause / Resume / Complete jobs with active-time tracking (pause-aware)
- Offline-tolerant: jobs cache locally and sync when back online
- OCR keytag scanning to auto-fill vehicle details
- Photos to private Storage, viewed via short-lived signed URLs
- Notes + chain-of-custody timeline per job
- Manager dashboard with stats and filters
- Per-dealership tenant isolation enforced by RLS

## Development

```bash
npm start           # Expo
npm run android     # Android
npm run ios         # iOS (Mac only)
npm test            # unit tests (node --test) — currently time-math
```

## Troubleshooting

- **"Supabase env vars missing" warning** — add `.env` (step 1) and restart with
  `npx expo start -c`.
- **Auth / empty data** — the account has no active dealership membership, or the
  RLS migrations aren't applied to the project.
- **OCR fails** — the `ocr-vehicle` function isn't deployed or `GEMINI_API_KEY`
  isn't set as a function secret.
- **App won't load** — `npx expo start --clear`, or reinstall `node_modules`.

## Tech Stack

- **Mobile**: React Native, Expo, AsyncStorage, React Navigation, @supabase/supabase-js
- **Backend**: Supabase (Postgres + RLS, Auth, Storage, Edge Functions/Deno)
- **Dashboard**: static HTML/JS + supabase-js

## Requirements

- Node.js 20+ LTS
- Expo Go (iOS/Android) or a dev build
- A Supabase project (URL + anon key in `.env`)

## Status

See `docs/OVERNIGHT_FINAL_SUMMARY.md` and `docs/SUPABASE_MIGRATION_PLAN.md` for
current state and the launch checklist.

## License

Private project — all rights reserved.
