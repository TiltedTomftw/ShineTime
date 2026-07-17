-- Phase 1 hardening, part 2: server-side rate limiting + self-enrollment.
--
-- Closes the TODOs left in 003_phase1_hardening.sql (verify_dealership_user_pin
-- had no throttling and was brute-forceable at the database layer) and
-- 004_onboarding.sql (generate_invite_code / redeem_invite_code unthrottled).
--
-- Idempotent: safe to re-run.
--
-- Transaction note: PostgREST runs each RPC in its own transaction, so a RAISE
-- rolls back everything the call did -- including any attempt counter it just
-- incremented. Every function below therefore RETURNS NULL on the paths that
-- must be counted, and only RAISEs where nothing needs to persist (authz
-- failures, and lockout itself, whose counter was committed by an earlier call).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- (a) rate_limit_buckets: generic counter keyed by an opaque bucket string.
--     RLS on with no policies + no grants: reachable only from the
--     SECURITY DEFINER functions below, which run as the table owner.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_buckets (
  bucket text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;

create index if not exists idx_rate_limit_buckets_updated
  on public.rate_limit_buckets (updated_at);

-- Raise if the bucket is currently locked out. Callers invoke this first.
create or replace function public.rate_limit_assert(p_bucket text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked timestamptz;
begin
  select locked_until into v_locked
  from public.rate_limit_buckets
  where bucket = p_bucket;

  if v_locked is not null and v_locked > now() then
    raise exception 'too many attempts - try again in % seconds',
      greatest(1, ceil(extract(epoch from (v_locked - now())))::int);
  end if;
end;
$$;

-- Count one attempt against the bucket; lock it once p_max is reached inside
-- p_window. Tripping the lock does NOT raise -- the caller returns normally so
-- the counter commits, and the *next* call is the one rate_limit_assert rejects.
create or replace function public.rate_limit_record(
  p_bucket text,
  p_max integer,
  p_window interval,
  p_lock interval
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limit_buckets as b (bucket, attempt_count, window_started_at, updated_at)
  values (p_bucket, 1, now(), now())
  on conflict (bucket) do update
    set attempt_count = case
          when b.window_started_at < now() - p_window then 1
          else b.attempt_count + 1
        end,
        window_started_at = case
          when b.window_started_at < now() - p_window then now()
          else b.window_started_at
        end,
        updated_at = now()
  returning b.attempt_count into v_count;

  if v_count >= p_max then
    update public.rate_limit_buckets
    set locked_until = now() + p_lock,
        attempt_count = 0,
        window_started_at = now(),
        updated_at = now()
    where bucket = p_bucket;
  end if;

  -- Opportunistic purge of stale rows (~1% of calls) so the table stays small
  -- without needing a scheduled job.
  if random() < 0.01 then
    delete from public.rate_limit_buckets
    where updated_at < now() - interval '1 day'
      and (locked_until is null or locked_until < now());
  end if;
end;
$$;

-- Clear a bucket after a successful attempt.
create or replace function public.rate_limit_clear(p_bucket text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rate_limit_buckets where bucket = p_bucket;
end;
$$;

-- These are internal plumbing: callable only by the definer functions below.
revoke all on function public.rate_limit_assert(text) from public, anon, authenticated;
revoke all on function public.rate_limit_record(text, integer, interval, interval) from public, anon, authenticated;
revoke all on function public.rate_limit_clear(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (b) verify_dealership_user_pin: now membership-gated and rate limited.
--     Replaces the 003 version. 5 failures per 15 min -> 15 min lockout,
--     keyed on dealership + name + role (not on the caller), so an attacker
--     cannot sidestep the limiter by rotating accounts.
-- ---------------------------------------------------------------------------
create or replace function public.verify_dealership_user_pin(
  p_dealership_id uuid,
  p_name text,
  p_role public.app_role,
  p_pin text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_bucket text;
begin
  -- Only a member of the dealership may attempt a PIN against it. This is the
  -- single biggest reduction in attack surface: a 4-digit PIN is only 10k
  -- guesses, so the roster must not be reachable by anon callers at all.
  if not public.is_member_of_dealership(p_dealership_id) then
    raise exception 'not allowed';
  end if;

  v_bucket := 'pin:' || p_dealership_id::text || ':' || lower(trim(coalesce(p_name, ''))) || ':' || p_role::text;
  perform public.rate_limit_assert(v_bucket);

  select id into v_id
  from public.dealership_users
  where dealership_id = p_dealership_id
    and lower(name) = lower(trim(coalesce(p_name, '')))
    and role = p_role
    and is_active = true
    and pin_hash = crypt(coalesce(p_pin, ''), pin_hash);

  if v_id is null then
    perform public.rate_limit_record(v_bucket, 5, interval '15 minutes', interval '15 minutes');
    return null;
  end if;

  perform public.rate_limit_clear(v_bucket);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- (c) enroll_dealership_user: lets an active member create their OWN operational
--     user on first login, without a manager pre-provisioning them (which is
--     what the client's "Create User" mode has always done).
--
--     The role is derived from the caller's membership, never passed in --
--     roles are membership-driven (see commit 52ac030). Owners operate as
--     managers, mirroring membershipRoleToOperational() in AuthContext.js.
--
--     Enrolling a name that already exists is refused rather than overwritten:
--     re-pinning an existing user stays owner/manager-only via
--     set_dealership_user_pin.
-- ---------------------------------------------------------------------------
create or replace function public.enroll_dealership_user(
  p_dealership_id uuid,
  p_name text,
  p_pin text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_id uuid;
  v_name text;
  v_bucket text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select m.role into v_role
  from public.dealership_memberships m
  where m.dealership_id = p_dealership_id
    and m.user_id = auth.uid()
    and m.is_active;

  if v_role is null then
    raise exception 'not a member of this dealership';
  end if;

  if v_role = 'owner' then
    v_role := 'manager';
  end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'user name is required';
  end if;
  if p_pin is null or length(trim(p_pin)) < 4 then
    raise exception 'pin must be at least 4 digits';
  end if;

  -- Modest anti-spam limit on roster growth: 10 enrollments per hour per user.
  v_bucket := 'enroll:' || auth.uid()::text;
  perform public.rate_limit_assert(v_bucket);

  insert into public.dealership_users (dealership_id, name, role, pin_hash)
  values (p_dealership_id, v_name, v_role, crypt(trim(p_pin), gen_salt('bf')))
  on conflict (dealership_id, lower(name), role) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'a user named % already exists for this role - log in instead, or ask a manager to reset the PIN', v_name;
  end if;

  perform public.rate_limit_record(v_bucket, 10, interval '1 hour', interval '1 hour');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- (d) generate_invite_code: throttled to 20 codes per hour per user.
--     Replaces the 004 version; body is otherwise unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.generate_invite_code(
  p_dealership_id uuid,
  p_role public.app_role default 'detailer',
  p_expires_in_hours integer default 168,
  p_max_uses integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- excludes ambiguous 0/O/1/I/L
  v_i integer;
  v_attempt integer := 0;
  v_bucket text;
begin
  if not public.has_dealership_role(p_dealership_id, array['owner','manager']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if p_role = 'owner' then
    raise exception 'cannot issue owner invite codes';
  end if;

  v_bucket := 'invite_gen:' || auth.uid()::text;
  perform public.rate_limit_assert(v_bucket);

  loop
    v_attempt := v_attempt + 1;
    v_code := '';
    for v_i in 1..7 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.dealership_invite_codes c where c.code = v_code);
    if v_attempt > 20 then raise exception 'could not generate unique code'; end if;
  end loop;

  insert into public.dealership_invite_codes (
    dealership_id, code, role, expires_at, max_uses, created_by
  ) values (
    p_dealership_id,
    v_code,
    p_role,
    case when p_expires_in_hours is not null then now() + make_interval(hours => p_expires_in_hours) else null end,
    p_max_uses,
    auth.uid()
  );

  perform public.rate_limit_record(v_bucket, 20, interval '1 hour', interval '1 hour');
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- (e) redeem_invite_code: throttled to 10 bad codes per 15 min per user.
--     BREAKING CHANGE vs 004: an invalid/expired/exhausted code now RETURNS
--     NULL instead of raising 'invalid or expired invite code'. It has to --
--     raising would roll back the failed-attempt counter and the limiter would
--     count nothing. Callers must treat a NULL result as a bad code
--     (see JoinByCodeScreen.js).
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.dealership_invite_codes;
  v_bucket text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  v_bucket := 'invite_redeem:' || auth.uid()::text;
  perform public.rate_limit_assert(v_bucket);

  select * into v_code
  from public.dealership_invite_codes
  where code = upper(trim(coalesce(p_code, '')))
    and is_active
  for update;

  if not found
     or (v_code.expires_at is not null and v_code.expires_at < now())
     or (v_code.max_uses is not null and v_code.used_count >= v_code.max_uses) then
    perform public.rate_limit_record(v_bucket, 10, interval '15 minutes', interval '15 minutes');
    return null;
  end if;

  -- If the caller is already a member, do not consume a use or re-add them.
  -- (Prevents a member re-redeeming to burn max_uses / inflate used_count.)
  if exists (
    select 1 from public.dealership_memberships m
    where m.dealership_id = v_code.dealership_id and m.user_id = auth.uid()
  ) then
    perform public.rate_limit_clear(v_bucket);
    return v_code.dealership_id;
  end if;

  insert into public.dealership_memberships (dealership_id, user_id, role, is_active)
  values (v_code.dealership_id, auth.uid(), v_code.role, true);

  update public.dealership_invite_codes
  set used_count = used_count + 1
  where id = v_code.id;

  perform public.rate_limit_clear(v_bucket);
  return v_code.dealership_id;
end;
$$;

grant execute on function public.enroll_dealership_user(uuid, text, text) to authenticated;
