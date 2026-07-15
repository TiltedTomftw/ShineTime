# Phase 2 — Self-Serve Onboarding (Groundwork)

Status: **DRAFT — nothing applied to the database, nothing wired into the app.**

Migration: [`supabase/migrations/004_onboarding.sql`](../supabase/migrations/004_onboarding.sql)

## The flow this enables

Today, dealerships and memberships are created by hand with service-role scripts.
This groundwork replaces that with a self-serve path:

1. **Manager signs up** with email/password (existing Supabase auth).
2. Manager calls `create_dealership(name)` → a dealership is created and the
   caller becomes its `owner`.
3. Manager calls `generate_invite_code(dealership_id, role)` → gets a short code
   (e.g. `K7QP2RX`) to share with staff.
4. **Detailer/tablet** signs in, then calls `redeem_invite_code(code)` → joins the
   dealership with the code's role. No admin pre-provisioning.

## What the migration adds

- **`dealership_invite_codes`** table (code, role, expiry, max_uses, used_count),
  RLS so only the dealership's owner/manager can see/manage its codes — codes are
  never publicly selectable and can only be validated via the RPC below.
- **`create_dealership(p_name)`** — SECURITY DEFINER; makes the caller owner;
  generates a unique slug.
- **`generate_invite_code(p_dealership_id, p_role, p_expires_in_hours, p_max_uses)`**
  — owner/manager only; refuses to mint `owner` codes.
- **`redeem_invite_code(p_code)`** — SECURITY DEFINER, tenant-safe, non-enumerable
  (one generic error for any bad code); adds the caller to the dealership and
  increments `used_count`.

## Known follow-ups before production

- **Rate limiting** on `generate_invite_code` / `redeem_invite_code` (marked with
  a `TODO` in the SQL) — brute-forcing a 7-char code is impractical but redeem
  attempts should still be throttled per user.
- Consider `gen_random_bytes` instead of `random()` for code generation.

## How to apply (do this yourself, review first)

```bash
# Review the SQL, then apply to a STAGING project first:
supabase db push            # if using the CLI against a linked project
# or paste 004_onboarding.sql into the Supabase SQL editor.
```

Apply `003_phase1_hardening.sql` **before or alongside** this — both are additive
and idempotent. Verify with a quick manual test: create a dealership as user A,
mint a code, redeem it as user B, confirm B sees only that dealership's data.
