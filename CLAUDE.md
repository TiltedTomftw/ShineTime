# Shinetime Detail Tracker — Claude working notes

Expo / React Native app (SDK 54) backed by Supabase. Full architecture lives in
[DEVELOPMENT.md](DEVELOPMENT.md); this file is the fast-path context + gotchas.

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
- `npm test` — `node --test` unit suites (`timeMath`, `jobLogic`).
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
- `supabase/functions/` — `ocr-vehicle`, `manager-dashboard`.

## Conventions

- Privileged work (OCR, etc.) runs in Edge Functions, never in the app.
- Duration math (`src/services/timeMath.js`) clamps negatives for clock skew; unit-tested.
- Pure, sync-critical logic is extracted into **CommonJS** modules (`timeMath.js`,
  `jobLogic.js`) so `node --test` can `require()` them without loading RN/Supabase.
  `storage.js` imports them. Add new pure helpers there and unit-test them, rather
  than burying testable logic inside the RN-coupled `storage.js`.
- Secrets live in repo-root `.env` (gitignored). Missing env → "Supabase env vars missing".

## Known issues to watch

- Dependency drift vs SDK 54: `expo-image-picker` is pinned `^55.0.13` but the SDK
  expects `~17.0.10` — verify photo capture before trusting it. `expo` and
  `expo-status-bar` are also a patch behind.
