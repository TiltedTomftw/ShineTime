-- Fix the server-side PIN RPCs from migration 003.
--
-- PROBLEM (found by probing the live DB): both functions are declared
--   SECURITY DEFINER SET search_path = public
-- but Supabase installs pgcrypto into the `extensions` schema, not `public`.
-- So crypt()/gen_salt() were unresolvable and every call failed with
--   42883: function gen_salt(unknown) does not exist
--   42883: function crypt(text, text) does not exist
-- i.e. the hashed-PIN identity in 003 could never have worked at runtime.
--
-- FIX: include `extensions` on the search_path of both functions (and keep
-- pgcrypto installed there). Bodies are otherwise unchanged from 003.
--
-- Idempotent: CREATE OR REPLACE only.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- (b) set_dealership_user_pin — manager/owner-gated upsert that hashes server-side.
CREATE OR REPLACE FUNCTION public.set_dealership_user_pin(
  p_dealership_id uuid,
  p_name text,
  p_role public.app_role,
  p_pin text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

-- (c) verify_dealership_user_pin — returns dealership_users.id on a correct,
--     active PIN match, else NULL.
--
--     Rate limiting is still NOT implemented (see 003's note); the product
--     decision is that the PIN is a "who's on this device" selector, not a
--     security boundary — auth + RLS are the real boundary.
CREATE OR REPLACE FUNCTION public.verify_dealership_user_pin(
  p_dealership_id uuid,
  p_name text,
  p_role public.app_role,
  p_pin text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
