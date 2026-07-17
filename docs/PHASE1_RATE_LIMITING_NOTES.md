# Migration 005 — Rate Limiting + Server-Side PIN Verification

**Status: NOT APPLIED.** `supabase/migrations/005_rate_limiting.sql` is a
reviewed draft that has never been run against a database. It was written
against the schema in migrations 001–004, not verified live: no token for the
Supabase management API exists on the dev machine and the `supabase` CLI isn't
installed, so applying it needs a human.

This closes the rate-limiting TODOs left in 003 and 004, and finally wires the
hashed-PIN identity from 003 into the client — until now `dealership_users` was
dead code and `AuthContext.js` compared PINs in cleartext against a device-local
AsyncStorage roster.

## Ordering constraint — read this first

**The client commit and this migration must ship together, migration first.**
`AuthContext.completeDealershipUserAccess` now calls `enroll_dealership_user`,
which does not exist in production yet. If the branch merges and ships ahead of
the migration, PIN login breaks for every user. Apply 005, then release.

Applying 005 *without* the client is safe on its own — the RPC signature changes
are backward-compatible except for `redeem_invite_code` (see below).

## The transaction constraint that shaped the design

PostgREST runs each RPC in a single transaction, so `RAISE` rolls back
everything the call did — **including an attempt counter it just incremented**.
A limiter that raises on the failure path therefore counts nothing.

So: every path that must be counted returns NULL instead of raising. Raising is
reserved for paths where nothing needs to persist — authz failures, and lockout
itself (whose counter was committed by an earlier call).

This makes `redeem_invite_code` a **breaking change vs 004**: an invalid,
expired, or exhausted code now returns NULL rather than raising
`'invalid or expired invite code'`. `JoinByCodeScreen.js` is updated to match.
Any other caller must treat NULL as a bad code.

## What's in the migration

- **`rate_limit_buckets`** — generic counter keyed by an opaque bucket string,
  with `rate_limit_assert` / `rate_limit_record` / `rate_limit_clear` helpers.
  RLS enabled with no policies and no grants, and EXECUTE revoked from
  `anon`/`authenticated`: reachable only from the `SECURITY DEFINER` functions,
  which run as the table owner. Stale rows are purged opportunistically on ~1%
  of calls, so no scheduled job is needed.

- **`verify_dealership_user_pin`** (replaces 003's) — two changes. It's now
  gated on `is_member_of_dealership`: a 4-digit PIN is only 10k guesses, so the
  roster must not be reachable by anon callers at all. This is a bigger win than
  the throttling itself. And it's limited to **5 failures / 15 min → 15 min
  lockout**, keyed on `dealership + name + role` rather than on the caller, so
  an attacker can't sidestep the limiter by rotating accounts.

- **`enroll_dealership_user`** (new) — the client's "Create User" mode has always
  let a detailer self-enroll, but `set_dealership_user_pin` is owner/manager-only.
  Rather than change that UX into manager pre-provisioning, this lets any active
  member enroll themselves. **Role is derived server-side from the caller's
  membership, never passed in** (roles are membership-driven — commit `52ac030`);
  owners map to `manager`, mirroring `membershipRoleToOperational()`. Enrolling a
  name that already exists is refused, not overwritten — re-pinning an existing
  user stays owner/manager-only via `set_dealership_user_pin`. Capped at 10
  enrollments/hour/user as anti-spam.

- **`generate_invite_code`** — 20/hour/user. **`redeem_invite_code`** — 10 bad
  codes / 15 min/user.

## Known tradeoffs

- **Lockout griefing.** Because the PIN limiter is keyed on the target
  (dealership+name+role) rather than the caller, one member can lock a coworker
  out for 15 minutes by burning 5 bad PINs against their name. This is the
  deliberate side of the tradeoff: caller-keyed limiting would let anyone with
  two accounts brute-force a 4-digit PIN. The membership gate means the attacker
  must already be inside the dealership, which is the realistic threat here (an
  insider guessing a manager's PIN), and target-keyed limiting is what stops it.
  If griefing shows up in practice, the fix is to key on both and lock the target
  only after failures arrive from multiple callers.

- **Everyone re-enrolls once.** `dealership_users` is empty in production, and
  existing PINs live only as cleartext in each device's AsyncStorage. They can't
  be migrated server-side without uploading cleartext PINs, so the first login
  after this ships requires "Create User". Names are first-come — a member could
  claim a coworker's name before they enroll. Low risk inside a single
  dealership, but worth knowing.

- **`set_dealership_user_pin` is unthrottled**, which is fine: it's manager-gated
  and not a guessing target.

## Client changes in the same commit

- `AuthContext.js` — calls `enroll_dealership_user` / `verify_dealership_user_pin`
  and persists no PIN anywhere. Upgrading devices purge the legacy cleartext
  roster (`@detailtracker_dealership_users:*`) and strip the `pin` field from any
  cached operational user, so old cleartext doesn't linger.
- `JoinByCodeScreen.js` — treats a NULL redeem as a bad code.

## Applying it (human action required)

Nothing here is verified. Whoever applies it should exercise the limiter rather
than assume it works.

1. Paste `supabase/migrations/005_rate_limiting.sql` into the SQL editor for
   project `oktqajirertyifyfixfa`, or apply via the management API with a
   Supabase access token (create one at
   https://supabase.com/dashboard/account/tokens).
2. Smoke-test, ideally on a throwaway dealership:
   - `enroll_dealership_user` creates a user; a second enroll of the same name
     is refused.
   - `verify_dealership_user_pin` returns the id for a correct PIN, NULL for a
     wrong one.
   - Five wrong PINs in a row, then a **correct** one → should still raise
     `too many attempts`. That's the assertion that proves the limiter fires;
     everything else passes even if the counter is silently broken.
   - After the lockout expires, a correct PIN succeeds and clears the bucket.
3. Only then release the client (see the ordering constraint above).
