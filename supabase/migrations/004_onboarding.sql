-- Phase 2 onboarding groundwork: self-serve dealership creation + invite codes.
-- DRAFT — NOT yet applied to any Supabase project. Review before applying.
-- Depends on 001_phase1_foundation.sql (dealerships, dealership_memberships,
-- app_role enum, has_dealership_role()).

create extension if not exists pgcrypto;

-- Invite codes let a manager/owner add teammates without pre-provisioning them.
create table if not exists public.dealership_invite_codes (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships(id) on delete cascade,
  code text not null unique,
  role public.app_role not null default 'detailer',
  expires_at timestamptz,
  max_uses integer,
  used_count integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_invite_codes_lookup
  on public.dealership_invite_codes (lower(code))
  where is_active;

create index if not exists idx_invite_codes_dealership
  on public.dealership_invite_codes (dealership_id, created_at desc);

alter table public.dealership_invite_codes enable row level security;

-- Managers/owners of the dealership manage its codes. No public SELECT — codes
-- are validated only through redeem_invite_code() (a SECURITY DEFINER RPC), so
-- they cannot be enumerated by anon users or by other tenants.
drop policy if exists invite_codes_select_manager on public.dealership_invite_codes;
create policy invite_codes_select_manager on public.dealership_invite_codes
for select using (public.has_dealership_role(dealership_id, array['owner','manager']::public.app_role[]));

drop policy if exists invite_codes_insert_manager on public.dealership_invite_codes;
create policy invite_codes_insert_manager on public.dealership_invite_codes
for insert with check (public.has_dealership_role(dealership_id, array['owner','manager']::public.app_role[]));

drop policy if exists invite_codes_update_manager on public.dealership_invite_codes;
create policy invite_codes_update_manager on public.dealership_invite_codes
for update using (public.has_dealership_role(dealership_id, array['owner','manager']::public.app_role[]))
with check (public.has_dealership_role(dealership_id, array['owner','manager']::public.app_role[]));

-- Helper: slugify a dealership name into a URL-safe token.
create or replace function public.slugify(p_text text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Create a dealership and make the caller its owner. Self-serve signup entry.
create or replace function public.create_dealership(p_name text)
returns public.dealerships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dealer public.dealerships;
  v_base text;
  v_slug text;
  v_suffix integer := 0;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'dealership name required';
  end if;

  v_base := nullif(public.slugify(p_name), '');
  if v_base is null then v_base := 'dealership'; end if;
  v_slug := v_base;

  -- Ensure a unique slug.
  while exists (select 1 from public.dealerships d where d.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix::text;
  end loop;

  insert into public.dealerships (name, slug)
  values (trim(p_name), v_slug)
  returning * into v_dealer;

  insert into public.dealership_memberships (dealership_id, user_id, role, is_active)
  values (v_dealer.id, auth.uid(), 'owner', true)
  on conflict (dealership_id, user_id) do update set role = 'owner', is_active = true;

  return v_dealer;
end;
$$;

-- Generate a shareable invite code for a dealership (owner/manager only).
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
begin
  if not public.has_dealership_role(p_dealership_id, array['owner','manager']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if p_role = 'owner' then
    raise exception 'cannot issue owner invite codes';
  end if;

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

  return v_code;
end;
$$;

-- TODO: add server-side rate limiting on generate_invite_code / redeem_invite_code
--       (e.g. per-user attempt counters) before exposing to production.

-- Redeem an invite code to join a dealership as the code's role.
-- SECURITY DEFINER so a not-yet-member caller can join; tenant-safe and
-- non-enumerable (any invalid/expired/exhausted code raises one generic error).
create or replace function public.redeem_invite_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.dealership_invite_codes;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select * into v_code
  from public.dealership_invite_codes
  where code = upper(trim(coalesce(p_code, '')))
    and is_active
  for update;

  if not found
     or (v_code.expires_at is not null and v_code.expires_at < now())
     or (v_code.max_uses is not null and v_code.used_count >= v_code.max_uses) then
    raise exception 'invalid or expired invite code';
  end if;

  insert into public.dealership_memberships (dealership_id, user_id, role, is_active)
  values (v_code.dealership_id, auth.uid(), v_code.role, true)
  on conflict (dealership_id, user_id) do nothing;

  update public.dealership_invite_codes
  set used_count = used_count + 1
  where id = v_code.id;

  return v_code.dealership_id;
end;
$$;
