-- Phase 1 hardening: server-side hashed-PIN detailer identity + RLS tightening
--
-- STATUS: APPLIED to production 2026-07-15 (see docs/PHASE1_HARDENING_NOTES.md).
--
-- Every statement below is written to be idempotent (safe to re-run) so that
-- review/iteration on this file can happen without needing to track a
-- separate "has this run yet" state.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- (a) dealership_users: server-side identity for shared-device / PIN-based
--     detailers and sales staff who do not have their own Supabase auth
--     account. Distinct from public.dealership_memberships, which models
--     auth.users who sign in individually (owners/managers).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dealership_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  name text NOT NULL,
  role public.app_role NOT NULL,
  pin_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness per dealership+role must be an expression index,
-- not an inline UNIQUE constraint (Postgres doesn't allow expressions there).
CREATE UNIQUE INDEX IF NOT EXISTS uq_dealership_users_name_role
  ON public.dealership_users (dealership_id, lower(name), role);

CREATE INDEX IF NOT EXISTS idx_dealership_users_dealership_active
  ON public.dealership_users(dealership_id, is_active);

ALTER TABLE public.dealership_users ENABLE ROW LEVEL SECURITY;

-- Any active member of the dealership can see the (non-secret) roster.
-- pin_hash is a bcrypt hash, safe to expose to authenticated dealership
-- members via SELECT, but callers should still prefer not to select it.
DROP POLICY IF EXISTS dealership_users_select_member ON public.dealership_users;
CREATE POLICY dealership_users_select_member ON public.dealership_users
FOR SELECT USING (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS dealership_users_insert_manager_owner ON public.dealership_users;
CREATE POLICY dealership_users_insert_manager_owner ON public.dealership_users
FOR INSERT WITH CHECK (
  public.has_dealership_role(dealership_id, ARRAY['owner', 'manager']::public.app_role[])
);

DROP POLICY IF EXISTS dealership_users_update_manager_owner ON public.dealership_users;
CREATE POLICY dealership_users_update_manager_owner ON public.dealership_users
FOR UPDATE USING (
  public.has_dealership_role(dealership_id, ARRAY['owner', 'manager']::public.app_role[])
) WITH CHECK (
  public.has_dealership_role(dealership_id, ARRAY['owner', 'manager']::public.app_role[])
);

-- ---------------------------------------------------------------------------
-- (b) set_dealership_user_pin: manager/owner-only upsert that hashes the PIN
--     server-side. Callers never send a pre-hashed value.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_dealership_user_pin(
  p_dealership_id uuid,
  p_name text,
  p_role public.app_role,
  p_pin text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_dealership_role(p_dealership_id, ARRAY['owner', 'manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF p_pin IS NULL OR length(p_pin) < 4 THEN
    RAISE EXCEPTION 'pin must be at least 4 characters';
  END IF;

  INSERT INTO public.dealership_users (dealership_id, name, role, pin_hash)
  VALUES (p_dealership_id, trim(p_name), p_role, crypt(p_pin, gen_salt('bf')))
  ON CONFLICT (dealership_id, lower(name), role)
  DO UPDATE SET
    pin_hash = EXCLUDED.pin_hash,
    is_active = true
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- (c) verify_dealership_user_pin: returns the dealership_users.id on a
--     correct, active PIN match, else NULL. SECURITY DEFINER so that
--     unauthenticated/low-privilege callers can verify without needing
--     direct SELECT access to pin_hash.
--
--     NOTE: this version has no throttling and is brute-forceable at the
--     database layer. 005_rate_limiting.sql replaces it with a membership-gated,
--     rate-limited version. Do not rely on the body below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_dealership_user_pin(
  p_dealership_id uuid,
  p_name text,
  p_role public.app_role,
  p_pin text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.dealership_users
  WHERE dealership_id = p_dealership_id
    AND lower(name) = lower(trim(p_name))
    AND role = p_role
    AND is_active = true
    AND pin_hash = crypt(p_pin, pin_hash);

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- (d) RLS tightening
-- ---------------------------------------------------------------------------

-- job_work_logs is an audit trail: make it insert-only. Remove the ability
-- to UPDATE existing log rows entirely (no replacement policy).
DROP POLICY IF EXISTS job_work_logs_update_member ON public.job_work_logs;

-- Recreate the INSERT policy to also pin actor_user_id to the caller, so a
-- member cannot write a work-log entry attributed to a different user.
DROP POLICY IF EXISTS job_work_logs_insert_member ON public.job_work_logs;
CREATE POLICY job_work_logs_insert_member ON public.job_work_logs
FOR INSERT WITH CHECK (
  public.is_member_of_dealership(dealership_id)
  AND (actor_user_id IS NULL OR actor_user_id = auth.uid())
);

-- job_notes: only the original author may update their own note (previously
-- any dealership member could edit any note).
DROP POLICY IF EXISTS job_notes_update_member ON public.job_notes;
CREATE POLICY job_notes_update_author ON public.job_notes
FOR UPDATE USING (
  author_user_id = auth.uid()
) WITH CHECK (
  author_user_id = auth.uid()
);

-- Completed jobs are locked: only owner/manager can update a job once its
-- status is 'completed'. Implemented as a trigger (rather than an RLS USING
-- clause) so the same rule applies uniformly regardless of which policy
-- would otherwise permit the UPDATE.
CREATE OR REPLACE FUNCTION public.enforce_completed_job_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'completed'
     AND NOT public.has_dealership_role(OLD.dealership_id, ARRAY['owner', 'manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'job is completed and can only be modified by an owner or manager';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_enforce_completed_lock ON public.jobs;
CREATE TRIGGER trg_jobs_enforce_completed_lock
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_completed_job_lock();
