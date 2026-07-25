# Shinetime Detail Tracker — Claude working notes

Expo / React Native app (SDK 54) backed by Supabase. Full architecture lives in
[DEVELOPMENT.md](DEVELOPMENT.md); this file is the fast-path context + gotchas.

## Two separate surfaces (read this before touching "the dashboard")

This product ships **two independent front-ends**. Do NOT conflate them:

1. **The mobile app** (this repo's `App.js` / `src/`) — the **detailer** tool.
   Detailers start/pause/resume/complete jobs, add notes/photos, scan keytags
   (OCR). A manager can sign in and see a *light* HomeScreen summary ("Recent
   Jobs" panel), but **the app is not the management tool** — keep the manager
   HomeScreen minimal.

2. **The manager dashboard** — a JIRA-style **standalone web app** that lives in
   THIS repo at **`dashboard/index.html`** (one self-contained static file;
   consolidated from the old `TiltedTomftw/shinetime-dashboard` repo). It is a
   **separate surface from the RN app** — do NOT rebuild its features inside the
   HomeScreen; edit `dashboard/index.html` directly. See `dashboard/README.md`.
   - **Deploy:** auto-published to GitHub Pages by
     `.github/workflows/deploy-dashboard.yml` on push to `main` (one-time:
     Settings → Pages → Source → "GitHub Actions").
   - **Usage:** opened per-dealership via `?d=DEALERSHIP_UUID`; manager signs in
     (email/password); reads Supabase directly (anon key + RLS).
   - **Features:** STATUS / DATE-RANGE / DETAILER / free-text SEARCH filters,
     Cards + Compact-Table views, stat tiles (Completed / Active / Paused / Avg),
     Top Detailers, Longest Active Jobs, Coverage (notes/photos/custody).
   - (Superseded copies to ignore: `server/public/manager.html` on branch
     `feature/supabase-remote-sync`, and the `supabase/functions/manager-dashboard`
     Edge Function.)

## Environment (read first)

- **Windows.** Bash tool uses Git Bash at `G:\Git\bin\bash.exe` (wired up via
  `CLAUDE_CODE_GIT_BASH_PATH` / `SHELL`, set at User scope + in
  `.claude/settings.local.json`). If the Bash tool ever errors "No suitable shell
  found," fall back to the **PowerShell tool** (Win PowerShell 5.1: no `&&`, no
  `?:`, use `;` / `if ($?)`).
- Node 22, npm 10, Expo CLI 54.x are installed.

## Commands

- `npm start` — Expo dev server (QR for Expo Go).
- `npm run web` — web build on :8081. Preview via `.claude/launch.json` config
  `expo-web` (never launch the dev server through Bash).
- `npm test` — `node --test` unit suites (`timeMath`, `jobLogic`). Pure logic only.
- `npm run test:components` — jest + `@testing-library/react-native` render tests
  (`__tests__/components/**/*.spec.js`). Runs in CI. **RNTL v14's `render`/`unmount`
  are async — always `await` them.** Named `.spec.js` on purpose so `node --test`
  doesn't try to run JSX.
- `npm run test:integration` — end-to-end suite against the REAL Supabase project
  (`__tests__/integration/`): RLS + tenant isolation, job lifecycle in Postgres,
  the completed-job lock, sync/reconcile semantics, manager write-backs. Needs
  `.env` + network, so it is deliberately **not** auto-discovered by `npm test`
  and **not** in CI. It creates throwaway dealerships/users per run and deletes
  them afterwards — it never touches real dealerships.
- `npm run lint` — eslint (flat config, `eslint-config-expo`). `npm run format` — prettier.
- `npx expo start -c` — clear Metro cache (needed after `.env` changes).

CI (`.github/workflows/ci.yml`) runs lint → format:check → tests on every push/PR.

## Project shape

- `App.js` — auth gate: session → dealership → role → PIN.
- `src/lib/supabase.js` — client (anon key is public; **RLS is the real security boundary**).
- `src/context/AuthContext.js` — session, profile, memberships, active dealership/role.
- `src/services/storage.js` — jobs CRUD + Supabase sync + pending-write queue
  (all local writes go through the `mutateLocalJobs` mutex).
- `src/services/ocr.js` — calls the `ocr-vehicle` Edge Function.
- `supabase/migrations/` — 001–002 applied; **003 (RLS/PIN) and 004 (onboarding)
  are drafted but NOT applied** (see `docs/PHASE1_HARDENING_NOTES.md`,
  `docs/PHASE2_ONBOARDING_NOTES.md`).
- `supabase/functions/` — `ocr-vehicle`, `manager-dashboard` (an older Edge-Function
  host for the manager page; the live dashboard is now on GitHub Pages — see above).

## Conventions

- Privileged work (OCR, etc.) runs in Edge Functions, never in the app.
- Duration math (`src/services/timeMath.js`) clamps negatives for clock skew; unit-tested.
- Pure, sync-critical logic is extracted into **CommonJS** modules (`timeMath.js`,
  `jobLogic.js`) so `node --test` can `require()` them without loading RN/Supabase.
  `storage.js` imports them. Add new pure helpers there and unit-test them, rather
  than burying testable logic inside the RN-coupled `storage.js`.
- Secrets live in repo-root `.env` (gitignored). Missing env → "Supabase env vars missing".

## Known issues to watch

- Keep dependencies SDK-aligned (`npx expo install <pkg>`, check `npx expo-doctor`).
  The `expo-image-picker` major-version mismatch was fixed (now `~17.0.11`); doctor
  was green at 18/18 as of the dev-tooling PR.
