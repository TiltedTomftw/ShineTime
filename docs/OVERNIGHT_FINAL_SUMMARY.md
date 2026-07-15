# Overnight Work — Final Summary & Morning Checklist

**Branch:** `feature/phase1-hardening` (off `feature/supabase-remote-sync`).
**Everything is branch-only:** nothing was applied to Supabase, nothing was
pushed to GitHub. Review, then act on the checklist at the bottom.

## What got done (commits, oldest → newest)

| Commit | What |
|--------|------|
| `checkpoint` | Preserved the prior uncommitted WIP (Supabase migration + earlier session cleanups) as its own commit before any new work. |
| Part 1 | Draft migration `003_phase1_hardening.sql` — server-side hashed-PIN identity (`dealership_users` + `set_/verify_dealership_user_pin` RPCs) and RLS tightening (audit log insert-only + actor-pinned, notes author-only, completed jobs locked to owner/manager). Notes in `docs/PHASE1_HARDENING_NOTES.md`. |
| Part 2 | `src/services/storage.js` — signed-URL expiry cut from 30 days to 1 hour; offline-safe merge in `syncJobsFromServer` (uses `mergeJobsPreferLocalIfNewer` so unsynced local edits are no longer overwritten); additive pending-write queue (`enqueuePendingJob` / `getPendingQueue` / `replayPendingQueue`) that retries failed writes on next sync. |
| Part 3 | `eas.json` (Android-first build profiles), `.github/workflows/ci.yml` (npm ci + tests, advisory typecheck), and `src/services/timeMath.js` + `__tests__/timeMath.test.js` (10 passing tests; the helpers clamp negative durations, fixing the clock-skew bug at the source). `npm test` is wired. |
| Part 4 | Draft migration `004_onboarding.sql` — `dealership_invite_codes` + `create_dealership` / `generate_invite_code` / `redeem_invite_code` RPCs (tenant-safe, non-enumerable). Notes in `docs/PHASE2_ONBOARDING_NOTES.md`. |
| Part 5 | Draft RN screens `CreateDealershipScreen`, `JoinByCodeScreen`, `ManageInviteCodesScreen` (call the Part 4 RPCs; not yet wired into navigation) + this summary. |

## Verified vs. NOT verified

- **Verified:** `npm test` passes (10/10 time-math tests).
- **NOT verified:** none of the client screen / storage.js changes were run in a
  live app or against Supabase (the work was done without launching Expo). Treat
  all of it as reviewable drafts, not tested behavior.
- **NOT applied:** migrations `003` and `004` have not touched any database.

## Your morning checklist (in order)

1. **Review the two migrations** — `supabase/migrations/003_phase1_hardening.sql`
   and `004_onboarding.sql`. Read `docs/PHASE1_HARDENING_NOTES.md` and
   `docs/PHASE2_ONBOARDING_NOTES.md`.
2. **Apply to a STAGING project first** (or a throwaway branch DB), not straight
   to production. Both are idempotent.
3. **Wire the PIN flow** to `verify_dealership_user_pin` — this is the real fix
   for the plaintext-PIN problem, and needs the rate-limiting TODO addressed
   before you rely on it. (Best done together, supervised.)
4. **Wire the onboarding screens** per the "Wiring the client screens" section of
   `PHASE2_ONBOARDING_NOTES.md`.
5. **Run the app** (`npm start`) and smoke-test: create job, photo, pause/resume,
   complete; then the onboarding path (create dealership → invite code → redeem).
6. **Adopt the `timeMath.js` helpers** inside `storage.js` (currently storage.js
   still computes durations inline) so the clock-skew clamp applies at runtime.
7. Only after staging looks good: apply `003`/`004` to production.

Nothing here is destructive or live — you can also just `git checkout
feature/supabase-remote-sync` to set it all aside.
