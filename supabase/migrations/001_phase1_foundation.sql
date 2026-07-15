-- Phase 1 foundation: multi-tenant schema + auth + RLS + compatibility payload

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner', 'manager', 'detailer', 'sales');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM (
    'queued',
    'in_progress',
    'paused',
    'completed',
    'needs_rework',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.issue_flag_status AS ENUM ('open', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Core tenancy tables
CREATE TABLE IF NOT EXISTS public.dealerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug citext NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dealership_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealership_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_active
  ON public.dealership_memberships(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_memberships_dealership_active
  ON public.dealership_memberships(dealership_id, is_active);

-- Jobs: structured columns + payload compatibility
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,

  -- Migration compatibility only; not primary app identity
  legacy_job_id text,

  status public.job_status NOT NULL DEFAULT 'queued',
  created_by_user_id uuid REFERENCES auth.users(id),
  assigned_detailer_id uuid REFERENCES auth.users(id),
  device_id text,

  stock_number text,
  vin text,
  make text,
  model text,
  year text,
  color text,

  started_at timestamptz,
  ended_at timestamptz,
  total_pause_ms bigint NOT NULL DEFAULT 0,
  total_active_ms bigint NOT NULL DEFAULT 0,

  client_updated_at timestamptz NOT NULL DEFAULT now(),

  -- Legacy JSON payload; keep in phase 1 for low-risk migration
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Supports composite FKs in child tables
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_id_dealership
  ON public.jobs(id, dealership_id);

-- Legacy mapping guard for backfill and old clients
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_dealership_legacy_job_id
  ON public.jobs(dealership_id, legacy_job_id)
  WHERE legacy_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_dealership_status_created
  ON public.jobs(dealership_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_dealership_assigned
  ON public.jobs(dealership_id, assigned_detailer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_dealership_vin
  ON public.jobs(dealership_id, vin);

CREATE INDEX IF NOT EXISTS idx_jobs_payload_gin
  ON public.jobs USING gin(payload);

-- Enforce one active job per stock number
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_active_per_stock
  ON public.jobs(dealership_id, stock_number)
  WHERE deleted_at IS NULL
    AND stock_number IS NOT NULL
    AND status IN ('queued', 'in_progress', 'paused', 'needs_rework');

-- Recommended secondary guard when stock_number is missing
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_active_per_vin
  ON public.jobs(dealership_id, vin)
  WHERE deleted_at IS NULL
    AND vin IS NOT NULL
    AND status IN ('queued', 'in_progress', 'paused', 'needs_rework');

CREATE TABLE IF NOT EXISTS public.job_work_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  dealership_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id),
  actor_name text,
  previous_owner_user_id uuid REFERENCES auth.users(id),
  new_owner_user_id uuid REFERENCES auth.users(id),
  note text,
  event_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_job_work_logs_job
    FOREIGN KEY (job_id, dealership_id)
    REFERENCES public.jobs(id, dealership_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_work_logs_job_event_at
  ON public.job_work_logs(job_id, event_at DESC);

CREATE TABLE IF NOT EXISTS public.job_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  dealership_id uuid NOT NULL,
  author_user_id uuid REFERENCES auth.users(id),
  author_name text,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_job_notes_job
    FOREIGN KEY (job_id, dealership_id)
    REFERENCES public.jobs(id, dealership_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_notes_job_created
  ON public.job_notes(job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.job_issue_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  dealership_id uuid NOT NULL,
  flagged_by_user_id uuid REFERENCES auth.users(id),
  flagged_by_name text,
  assigned_to_user_id uuid REFERENCES auth.users(id),
  issue_type text NOT NULL,
  note text,
  status public.issue_flag_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_job_issue_flags_job
    FOREIGN KEY (job_id, dealership_id)
    REFERENCES public.jobs(id, dealership_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_issue_resolved_time
    CHECK ((status = 'resolved' AND resolved_at IS NOT NULL) OR status <> 'resolved')
);

CREATE INDEX IF NOT EXISTS idx_job_issue_flags_job_status
  ON public.job_issue_flags(job_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.job_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  dealership_id uuid NOT NULL,
  uploaded_by_user_id uuid REFERENCES auth.users(id),
  uploaded_by_name text,
  storage_path text NOT NULL,
  photo_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_job_photos_job
    FOREIGN KEY (job_id, dealership_id)
    REFERENCES public.jobs(id, dealership_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_photos_job_created
  ON public.job_photos(job_id, created_at DESC);

-- Trigger helpers
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_set_updated_at ON public.jobs;
CREATE TRIGGER trg_jobs_set_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_set_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS helpers
CREATE OR REPLACE FUNCTION public.is_member_of_dealership(target_dealership_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dealership_memberships m
    WHERE m.dealership_id = target_dealership_id
      AND m.user_id = auth.uid()
      AND m.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.has_dealership_role(target_dealership_id uuid, allowed_roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dealership_memberships m
    WHERE m.dealership_id = target_dealership_id
      AND m.user_id = auth.uid()
      AND m.is_active = true
      AND m.role = ANY(allowed_roles)
  );
$$;

-- Enable RLS
ALTER TABLE public.dealerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealership_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_work_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_issue_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;

-- Policies (drop+recreate for idempotency)
DROP POLICY IF EXISTS dealerships_select_member ON public.dealerships;
CREATE POLICY dealerships_select_member ON public.dealerships
FOR SELECT USING (public.is_member_of_dealership(id));

DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
CREATE POLICY profiles_select_self ON public.profiles
FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self ON public.profiles
FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS memberships_select_own_or_manager ON public.dealership_memberships;
CREATE POLICY memberships_select_own_or_manager ON public.dealership_memberships
FOR SELECT USING (
  user_id = auth.uid()
  OR public.has_dealership_role(dealership_id, ARRAY['owner', 'manager']::public.app_role[])
);

DROP POLICY IF EXISTS jobs_select_member ON public.jobs;
CREATE POLICY jobs_select_member ON public.jobs
FOR SELECT USING (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS jobs_insert_member ON public.jobs;
CREATE POLICY jobs_insert_member ON public.jobs
FOR INSERT WITH CHECK (
  public.is_member_of_dealership(dealership_id)
  AND (created_by_user_id IS NULL OR created_by_user_id = auth.uid())
);

DROP POLICY IF EXISTS jobs_update_member ON public.jobs;
CREATE POLICY jobs_update_member ON public.jobs
FOR UPDATE USING (public.is_member_of_dealership(dealership_id))
WITH CHECK (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS jobs_delete_manager_owner ON public.jobs;
CREATE POLICY jobs_delete_manager_owner ON public.jobs
FOR DELETE USING (public.has_dealership_role(dealership_id, ARRAY['owner', 'manager']::public.app_role[]));

DROP POLICY IF EXISTS job_work_logs_select_member ON public.job_work_logs;
CREATE POLICY job_work_logs_select_member ON public.job_work_logs
FOR SELECT USING (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_work_logs_insert_member ON public.job_work_logs;
CREATE POLICY job_work_logs_insert_member ON public.job_work_logs
FOR INSERT WITH CHECK (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_work_logs_update_member ON public.job_work_logs;
CREATE POLICY job_work_logs_update_member ON public.job_work_logs
FOR UPDATE USING (public.is_member_of_dealership(dealership_id))
WITH CHECK (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_notes_select_member ON public.job_notes;
CREATE POLICY job_notes_select_member ON public.job_notes
FOR SELECT USING (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_notes_insert_member ON public.job_notes;
CREATE POLICY job_notes_insert_member ON public.job_notes
FOR INSERT WITH CHECK (
  public.is_member_of_dealership(dealership_id)
  AND (author_user_id IS NULL OR author_user_id = auth.uid())
);

DROP POLICY IF EXISTS job_notes_update_member ON public.job_notes;
CREATE POLICY job_notes_update_member ON public.job_notes
FOR UPDATE USING (public.is_member_of_dealership(dealership_id))
WITH CHECK (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_issue_flags_select_member ON public.job_issue_flags;
CREATE POLICY job_issue_flags_select_member ON public.job_issue_flags
FOR SELECT USING (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_issue_flags_insert_member ON public.job_issue_flags;
CREATE POLICY job_issue_flags_insert_member ON public.job_issue_flags
FOR INSERT WITH CHECK (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_issue_flags_update_member ON public.job_issue_flags;
CREATE POLICY job_issue_flags_update_member ON public.job_issue_flags
FOR UPDATE USING (public.is_member_of_dealership(dealership_id))
WITH CHECK (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_photos_select_member ON public.job_photos;
CREATE POLICY job_photos_select_member ON public.job_photos
FOR SELECT USING (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_photos_insert_member ON public.job_photos;
CREATE POLICY job_photos_insert_member ON public.job_photos
FOR INSERT WITH CHECK (public.is_member_of_dealership(dealership_id));

DROP POLICY IF EXISTS job_photos_delete_manager_owner ON public.job_photos;
CREATE POLICY job_photos_delete_manager_owner ON public.job_photos
FOR DELETE USING (public.has_dealership_role(dealership_id, ARRAY['owner', 'manager']::public.app_role[]));

-- Normalize incoming status text into enum values
CREATE OR REPLACE FUNCTION public.normalize_job_status(input_status text)
RETURNS public.job_status
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE lower(coalesce(input_status, 'queued'))
    WHEN 'queued' THEN RETURN 'queued';
    WHEN 'in_progress' THEN RETURN 'in_progress';
    WHEN 'paused' THEN RETURN 'paused';
    WHEN 'completed' THEN RETURN 'completed';
    WHEN 'needs_rework' THEN RETURN 'needs_rework';
    WHEN 'cancelled' THEN RETURN 'cancelled';
    ELSE RETURN 'queued';
  END CASE;
END;
$$;

-- RPC: create active job or return conflicting active job
CREATE OR REPLACE FUNCTION public.create_or_get_active_job(
  p_dealership_id uuid,
  p_stock_number text,
  p_vin text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  INSERT INTO public.jobs (
    dealership_id,
    stock_number,
    vin,
    status,
    created_by_user_id,
    assigned_detailer_id,
    payload,
    client_updated_at
  ) VALUES (
    p_dealership_id,
    NULLIF(trim(p_stock_number), ''),
    NULLIF(trim(p_vin), ''),
    'queued',
    auth.uid(),
    auth.uid(),
    coalesce(p_payload, '{}'::jsonb),
    now()
  )
  RETURNING * INTO v_job;

  RETURN v_job;
EXCEPTION
  WHEN unique_violation THEN
    SELECT *
    INTO v_job
    FROM public.jobs j
    WHERE j.dealership_id = p_dealership_id
      AND j.deleted_at IS NULL
      AND j.status IN ('queued', 'in_progress', 'paused', 'needs_rework')
      AND (
        (p_stock_number IS NOT NULL AND j.stock_number = p_stock_number)
        OR (p_vin IS NOT NULL AND j.vin = p_vin)
      )
    ORDER BY j.created_at DESC
    LIMIT 1;

    RETURN v_job;
END;
$$;

-- RPC: transfer ownership + write handoff work-log
CREATE OR REPLACE FUNCTION public.transfer_job_ownership(
  p_job_id uuid,
  p_new_owner_user_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_job public.jobs;
  v_prev_owner uuid;
BEGIN
  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF NOT public.is_member_of_dealership(v_job.dealership_id) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  v_prev_owner := v_job.assigned_detailer_id;

  UPDATE public.jobs
  SET assigned_detailer_id = p_new_owner_user_id,
      client_updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  INSERT INTO public.job_work_logs (
    job_id,
    dealership_id,
    event_type,
    actor_user_id,
    previous_owner_user_id,
    new_owner_user_id,
    note,
    event_at,
    metadata
  ) VALUES (
    v_job.id,
    v_job.dealership_id,
    'handoff',
    auth.uid(),
    v_prev_owner,
    p_new_owner_user_id,
    p_note,
    now(),
    jsonb_build_object(
      'previous_owner_user_id', v_prev_owner,
      'new_owner_user_id', p_new_owner_user_id
    )
  );

  RETURN v_job;
END;
$$;

-- RPC: batch sync with stale-write protection (reject stale updates)
CREATE OR REPLACE FUNCTION public.sync_jobs_batch(
  p_dealership_id uuid,
  p_jobs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_item jsonb;
  v_legacy_job_id text;
  v_processed integer := 0;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_client_updated_at timestamptz;
  v_status public.job_status;
BEGIN
  IF NOT public.is_member_of_dealership(p_dealership_id) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF p_jobs IS NULL OR jsonb_typeof(p_jobs) <> 'array' THEN
    RAISE EXCEPTION 'p_jobs must be a JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_jobs)
  LOOP
    v_processed := v_processed + 1;
    v_legacy_job_id := nullif(trim(coalesce(v_item->>'jobId', '')), '');

    IF v_legacy_job_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_status := public.normalize_job_status(v_item->>'status');
    v_client_updated_at := COALESCE(
      to_timestamp(NULLIF(v_item->>'updatedAt', '')::double precision / 1000.0),
      now()
    );

    INSERT INTO public.jobs (
      dealership_id,
      legacy_job_id,
      status,
      created_by_user_id,
      assigned_detailer_id,
      device_id,
      stock_number,
      vin,
      make,
      model,
      year,
      color,
      started_at,
      ended_at,
      total_pause_ms,
      total_active_ms,
      client_updated_at,
      payload
    ) VALUES (
      p_dealership_id,
      v_legacy_job_id,
      v_status,
      auth.uid(),
      auth.uid(),
      nullif(v_item->>'deviceId', ''),
      nullif(v_item->>'stockNumber', ''),
      nullif(v_item->>'vin', ''),
      nullif(v_item->>'make', ''),
      nullif(v_item->>'model', ''),
      nullif(v_item->>'year', ''),
      nullif(v_item->>'color', ''),
      CASE WHEN nullif(v_item->>'startTime', '') IS NOT NULL THEN to_timestamp((v_item->>'startTime')::double precision / 1000.0) ELSE NULL END,
      CASE WHEN nullif(v_item->>'endTime', '') IS NOT NULL THEN to_timestamp((v_item->>'endTime')::double precision / 1000.0) ELSE NULL END,
      COALESCE(NULLIF(v_item->>'totalPauseTime', '')::bigint, 0),
      COALESCE(NULLIF(v_item->>'totalActiveTime', '')::bigint, 0),
      v_client_updated_at,
      v_item
    )
    ON CONFLICT (dealership_id, legacy_job_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      device_id = EXCLUDED.device_id,
      stock_number = EXCLUDED.stock_number,
      vin = EXCLUDED.vin,
      make = EXCLUDED.make,
      model = EXCLUDED.model,
      year = EXCLUDED.year,
      color = EXCLUDED.color,
      started_at = EXCLUDED.started_at,
      ended_at = EXCLUDED.ended_at,
      total_pause_ms = EXCLUDED.total_pause_ms,
      total_active_ms = EXCLUDED.total_active_ms,
      client_updated_at = EXCLUDED.client_updated_at,
      payload = EXCLUDED.payload
    WHERE public.jobs.client_updated_at <= EXCLUDED.client_updated_at;

    IF FOUND THEN
      v_applied := v_applied + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'applied', v_applied,
    'skipped', v_skipped
  );
END;
$$;
