# Shinetime Detail Tracker — Claude working notes

Expo / React Native app (SDK 54) backed by Supabase. Full architecture lives in
[DEVELOPMENT.md](DEVELOPMENT.md); this file is the fast-path context + gotchas.

## Two separate surfaces (read this before touching "the dashboard")

This product ships **two independent front-ends**. Do NOT conflate them:

1. **The mobile app** (this repo's `App.js` / `src/`) — the **detailer** tool.
   Start/pause/resume/complete jobs, notes/photos, keytag scans (OCR). **It has
   no manager mode** (decided Oct 2026): everyone, managers included, sees only
   their own cars. Service managers work at a desk PC, so every manager feature
   (oversight, rework, reassign, team/PINs, invite codes) lives ONLY on the web
   dashboard. Don't add manager screens to the app; the Account screen just
   points managers to the dashboard.

2. **The manager dashboard** — a JIRA-style **standalone web app** that lives in
   THIS repo at **`dashboard/index.html`** (one self-contained static file;
   consolidated from the old `TiltedTomftw/shinetime-dashboard` repo). It is a
   **separate surface from the RN app** — do NOT rebuild its features inside the
   HomeScreen; edit `dashboard/index.html` directly. See `dashboard/README.md`.
   - **Deploy:** auto-published to GitHub Pages by
     `.github/workflows/deploy-dashboard.yml` on push to `main` (one-time:
     Settings → Pages → Source → "GitHub Actions").
   - **Usage:** manager signs in with a real form (email/password); the
     dealership comes from their memberships (`?d=UUID` still honoured, not
     required). Reads Supabase directly (anon key + RLS).
   - **Features:** DATE (default Today) / STATUS (incl. Rework) / DETAILER /
     SEARCH filters (detailer + search filter client-side), Cards + Table,
     stat tiles, Top Detailers, Longest Open Jobs, Coverage, Reopen for Rework
     (with a note), Reassign from the team, and a **Team** page (PIN reset,
     turn off/on, invite codes) via the `employee-access` function. Photos are
     signed fresh from `job_photos` (never from payload URLs).
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
- `npm test` — `node --test` unit suites (`timeMath`, `jobLogic`, `outbox`). Pure logic only.
- `npm run test:components` — jest + `@testing-library/react-native` render tests
  (`__tests__/components/**/*.spec.js`). Runs in CI. **RNTL v14's `render`/`unmount`
  are async — always `await` them.** Named `.spec.js` on purpose so `node --test`
  doesn't try to run JSX.
- `npm run test:integration` — end-to-end suite against the REAL Supabase project
  (`__tests__/integration/`): RLS + tenant isolation, job lifecycle in Postgres,
  the completed-job lock, actions applied to the server copy, manager write-backs.
  The dashboard suite alone (jsdom, no network) runs with
  `node --test __tests__/integration/dashboard.integration.js`. Needs
  `.env` + network, so it is deliberately **not** auto-discovered by `npm test`
  and **not** in CI. It creates throwaway dealerships/users per run and deletes
  them afterwards — it never touches real dealerships.
- `npm run lint` — eslint (flat config, `eslint-config-expo`). `npm run format` — prettier.
- `npx expo start -c` — clear Metro cache (needed after `.env` changes).

CI (`.github/workflows/ci.yml`) runs lint → format:check → tests on every push/PR.

## Project shape

- `App.js` — auth gate: session → account loaded (else Retry screen) → dealership → app.
- `src/lib/supabase.js` — client (anon key is public; **RLS is the real security boundary**).
- `src/context/AuthContext.js` — session, profile, memberships, active dealership/role;
  sets the services' session context and starts the per-person outbox.
- **Supabase is the source of truth for jobs.** The phone keeps NO job list —
  only `outbox` entries (unsent actions + photo files), each deleted as soon as
  Supabase confirms it, and cleared on sign-out. Don't reintroduce a local cache.
  - `src/services/jobs.js` — reads (`fetchOpenJobs`, `fetchJob`, `fetchHistory`,
    `fetchTodayStats`) + actions (`createJob`, `performJobAction`, `addJobPhoto`).
  - `src/services/outboxCore.js` (pure rules) / `outbox.js` (RN wiring) /
    `jobSync.js` (sends one entry: re-read row → `applyJobAction` → save with a
    `client_updated_at` check).
- `src/services/ocr.js` — calls the `ocr-vehicle` Edge Function.
- `supabase/functions/employee-access` — employee join/sign-in (modes `join` /
  `signin`; returning staff can use expired codes) + manager actions
  `list_employees`, `reset_pin`, `set_active`. **Changes need
  `npx supabase functions deploy employee-access`.**
- UI: `src/theme.js` tokens + `src/components/ui.js` (Button, Card, Field,
  StatusPill, Notice…). Use these; don't hardcode colours.
- `supabase/migrations/` — 001–002 applied; **003 (RLS/PIN) and 004 (onboarding)
  are drafted but NOT applied** (see `docs/PHASE1_HARDENING_NOTES.md`,
  `docs/PHASE2_ONBOARDING_NOTES.md`).
- `supabase/functions/` — `ocr-vehicle`, `manager-dashboard` (an older Edge-Function
  host for the manager page; the live dashboard is now on GitHub Pages — see above).

## Conventions

- Privileged work (OCR, etc.) runs in Edge Functions, never in the app.
- Duration math (`src/services/timeMath.js`) clamps negatives for clock skew; unit-tested.
- Pure, sync-critical logic is extracted into **CommonJS** modules (`timeMath.js`,
  `jobLogic.js`, `outboxCore.js`) so `node --test` can `require()` them without
  loading RN/Supabase. Every job state change goes through `applyJobAction`; add
  new actions there and unit-test them.
- Secrets live in repo-root `.env` (gitignored). Missing env → "Supabase env vars missing".

## Known issues to watch

- Keep dependencies SDK-aligned (`npx expo install <pkg>`, check `npx expo-doctor`).
  The `expo-image-picker` major-version mismatch was fixed (now `~17.0.11`); doctor
  was green at 18/18 as of the dev-tooling PR.
