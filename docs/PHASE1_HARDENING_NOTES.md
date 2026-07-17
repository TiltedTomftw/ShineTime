# Phase 1 Hardening — Migration 003 Notes

**Status: APPLIED** to production (`oktqajirertyifyfixfa`) on 2026-07-15, after
fixing one bug found on the way in: `lower(name)` uniqueness can't live in an
inline `UNIQUE` constraint and had to become a unique index (commit `2e5fc4b`).
The "manual steps to apply" section below is kept for reference but has already
been carried out.

**The rate-limiting gap described in section (c) is closed by migration 005**
(`supabase/migrations/005_rate_limiting.sql`, drafted 2026-07-16, **not yet
applied**) — see [`PHASE1_RATE_LIMITING_NOTES.md`](PHASE1_RATE_LIMITING_NOTES.md).
005 also supersedes this file's claim that PIN identity is unwired: it wires
`verify_dealership_user_pin` into `AuthContext.js` and adds
`enroll_dealership_user` for self-enrollment.

This document explains what the migration does and why.

## What's in the migration

### a) `public.dealership_users` — server-side PIN identity

Today, detailer/sales identity on shared devices is handled client-side
(see `src/screens/UserPinScreen.js`, `src/screens/RoleSelectionScreen.js`).
There's no server-side record of "who is Detailer Bob" independent of a full
Supabase auth account, which means:

- The app can't attribute `job_work_logs` / `job_notes` rows to a specific
  detailer without giving every detailer their own `auth.users` row.
- There's no server-enforced check on a shared-device PIN — anything
  client-side is trivially bypassable by someone with the app installed.

`dealership_users` gives each dealership a roster of named, roled identities
(`owner`/`manager`/`detailer`/`sales`, reusing `public.app_role`) with a
bcrypt-hashed PIN (`pin_hash`, via `pgcrypto`'s `crypt()`/`gen_salt('bf')`).
RLS: any active dealership member can `SELECT` the roster (needed for the
device-side "pick your name" UI); only `owner`/`manager` can `INSERT` or
`UPDATE` rows — i.e., only managers set/reset PINs.

**This does not replace `dealership_memberships`** (real `auth.users`
accounts for owners/managers who log in individually). It's a separate,
narrower mechanism for shared-device staff.

### b) `set_dealership_user_pin(...)` RPC

`SECURITY DEFINER` upsert, gated on caller having `owner`/`manager` role in
the target dealership. Takes a plaintext PIN and hashes it server-side with
`crypt(p_pin, gen_salt('bf'))` — the plaintext PIN is never stored, and the
hashing decision isn't left to client code. Rejects PINs under 4 characters
as a minimal sanity check.

### c) `verify_dealership_user_pin(...)` RPC

`SECURITY DEFINER`, returns the matching `dealership_users.id` if
`crypt(p_pin, pin_hash) = pin_hash` and the row is `is_active`, else `NULL`.
`SECURITY DEFINER` is required here specifically so this can be called by a
low-privilege/anon-ish context (a detailer picking their name + entering a
PIN, before they're "logged in" as anyone) without granting broad `SELECT`
on `pin_hash` directly.

**Known gap, called out explicitly in the SQL comment:** this RPC has no
rate limiting. As written it's brute-forceable at the database layer (an
attacker with `EXECUTE` on the function could try PINs in a loop). A
`-- TODO: add server-side rate limiting` comment marks this. Before this RPC
is wired into a real login flow, add either:
- an attempts/lockout table keyed on `(dealership_id, name)` with a cooldown, or
- a Postgres advisory lock / minimum-interval check, or
- application-layer throttling in front of the RPC (e.g. an Edge Function
  wrapper with rate limiting instead of calling the RPC directly from the
  client).

### d) RLS tightening

Four independent changes to existing tables from migration 001:

1. **`job_work_logs` becomes insert-only.** The `job_work_logs_update_member`
   UPDATE policy is dropped with no replacement — this table is an audit
   log of job events (handoffs, etc.) and should never be mutated after the
   fact. Previously any dealership member could `UPDATE` any log row, which
   defeats the purpose of an audit trail.
2. **`job_work_logs` INSERT now pins `actor_user_id` to the caller.** The
   insert policy is recreated to additionally require
   `actor_user_id = auth.uid()` (when set), so a member can no longer write
   a log entry falsely attributed to a different user.
3. **`job_notes` UPDATE becomes author-only.** Previously any dealership
   member could edit any note (`job_notes_update_member`, USING/WITH CHECK
   only checked dealership membership). The new
   `job_notes_update_author` policy requires `author_user_id = auth.uid()`
   in both USING and WITH CHECK.
4. **Completed jobs are locked to owner/manager.** A new `BEFORE UPDATE`
   trigger (`trg_jobs_enforce_completed_lock` /
   `enforce_completed_job_lock()`) raises an exception if
   `OLD.status = 'completed'` and the caller doesn't have `owner`/`manager`
   role in that job's dealership. This is implemented as a trigger (not an
   RLS `USING` clause) so it applies uniformly on top of whatever RLS policy
   would otherwise have allowed the row through — a detailer can no longer
   edit a job's payload/status/etc. after it's been marked complete.

## Why a trigger for (d.4) instead of RLS?

`jobs_update_member` (from migration 001) allows any dealership member to
update any job row. Rather than rewriting that policy's `USING`/`WITH CHECK`
clauses to special-case `status = 'completed'` (which gets awkward because
`WITH CHECK` sees the *new* row, and you need the *old* row's status), a
`BEFORE UPDATE` trigger cleanly checks `OLD.status` and raises, regardless of
which RLS policy path let the UPDATE through. It composes with RLS instead
of replacing it.

## Idempotency

Every statement is safe to re-run:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `DROP POLICY IF EXISTS` before every `CREATE POLICY`
- `CREATE OR REPLACE FUNCTION` for all functions
- `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`
- `CREATE EXTENSION IF NOT EXISTS`

## Manual steps to review and apply (human action required)

1. **Read the migration file directly:**
   `supabase/migrations/003_phase1_hardening.sql`
2. **Review on a non-production target first if possible.** If you have a
   local Supabase stack (`supabase start`) or a separate staging project,
   apply there first:
   ```
   supabase db push --db-url <staging-or-local-connection-string>
   ```
   or paste the file contents into that project's SQL editor and run it.
3. **Check for behavior changes that need a client update before/alongside
   applying to production:**
   - Any code that currently `UPDATE`s `job_work_logs` will start failing
     (by design — audit log is now insert-only). Search the client for
     writes to that table.
   - Any code letting a non-author edit someone else's `job_notes` will
     start failing.
   - Any code that updates a job after marking it `completed` (outside
     owner/manager) will start failing.
   - `set_dealership_user_pin` / `verify_dealership_user_pin` are net-new
     and inert until client code calls them — safe to apply without a
     coordinated client release, but they don't do anything useful until
     `UserPinScreen.js` / `RoleSelectionScreen.js` are wired up to call
     them.
4. **Apply to production**, once reviewed, using the project's normal
   Supabase CLI flow (matching how migrations 001/002 were applied):
   ```
   supabase link --project-ref oktqajirertyifyfixfa   # if not already linked
   supabase db push
   ```
   or run the file's contents directly in the Supabase Studio SQL editor for
   project `oktqajirertyifyfixfa`.
5. **Before relying on `verify_dealership_user_pin` in a real login flow**,
   resolve the rate-limiting TODO in the RPC (see section c above).
6. **Verify RLS behavior post-apply** using the existing checklist in
   [`docs/RLS_VERIFICATION_CHECKLIST.md`](RLS_VERIFICATION_CHECKLIST.md),
   extended to cover: job_work_logs update now rejected, job_notes update
   rejected for non-authors, jobs update rejected on completed jobs for
   non-manager roles, and dealership_users select/insert/update role checks.

## What this migration does NOT do

- It does not migrate any existing client-side PIN data into
  `dealership_users` — that table starts empty.
- It does not change how `src/services/storage.js` or any screen currently
  authenticates users; wiring the client to `set_dealership_user_pin` /
  `verify_dealership_user_pin` is separate follow-up work.
- It does not add rate limiting (explicitly deferred, see TODO above).
