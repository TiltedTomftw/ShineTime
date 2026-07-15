# Overnight Phase 1 Hardening — Progress Log

Branch: `feature/phase1-hardening` (created from `feature/supabase-remote-sync`).
All work is branch-only — nothing has been pushed, and no migration has been
applied to any Supabase project.

## 2026-07-15 — Part 1: Foundation (`phase1-part1-foundation`)

- Committed pre-existing uncommitted working-tree changes on
  `feature/supabase-remote-sync` as a checkpoint (commit `8a03030`,
  "checkpoint: WIP before phase1 hardening") to preserve that work before
  branching.
- Created branch `feature/phase1-hardening` from that checkpoint.
- Added draft migration
  [`supabase/migrations/003_phase1_hardening.sql`](../supabase/migrations/003_phase1_hardening.sql):
  - `public.dealership_users` table (server-side hashed-PIN identity for
    shared-device detailer/sales roles) + RLS policies.
  - `set_dealership_user_pin(...)` RPC (manager/owner-gated, hashes PIN with
    `pgcrypto`'s `crypt()`/`gen_salt('bf')`).
  - `verify_dealership_user_pin(...)` RPC (returns user id on correct PIN,
    else NULL). Flagged with a `TODO: add server-side rate limiting` — not
    yet safe to expose to a real login flow without throttling.
  - RLS tightening: `job_work_logs` is now insert-only (audit trail) and its
    INSERT policy pins `actor_user_id = auth.uid()`; `job_notes` updates are
    now author-only; a new `BEFORE UPDATE` trigger on `public.jobs` blocks
    non-owner/manager edits to jobs already `completed`.
  - Every statement is idempotent (safe to re-run / re-review).
- Added [`docs/PHASE1_HARDENING_NOTES.md`](PHASE1_HARDENING_NOTES.md)
  explaining the rationale for each change and the exact manual steps to
  review and apply the migration later (`supabase db push` or SQL editor,
  ideally against staging/local first).
- Commit: `4fd14ea` — "Phase 1 hardening: draft server-side PIN identity +
  RLS tightening (not applied)".

**Nothing was applied to the database. Nothing was pushed to GitHub.**

Left for the human: review `003_phase1_hardening.sql` and
`PHASE1_HARDENING_NOTES.md`, then apply the migration per the steps in that
notes file when ready.
