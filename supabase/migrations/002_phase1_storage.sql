-- Phase 1 storage foundation: dealership-scoped photo bucket policies

-- Private bucket for job photos
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

create or replace function public.extract_dealership_id_from_path(p_path text)
returns uuid
language plpgsql
immutable
as $$
declare
  v_first_segment text;
begin
  v_first_segment := nullif(split_part(coalesce(p_path, ''), '/', 1), '');
  if v_first_segment is null then
    return null;
  end if;
  return v_first_segment::uuid;
exception when others then
  return null;
end;
$$;

-- Read objects only for users in matching dealership path prefix
DROP POLICY IF EXISTS storage_job_photos_select ON storage.objects;
CREATE POLICY storage_job_photos_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'job-photos'
  AND public.is_member_of_dealership(public.extract_dealership_id_from_path(name))
);

-- Upload only to your dealership path
DROP POLICY IF EXISTS storage_job_photos_insert ON storage.objects;
CREATE POLICY storage_job_photos_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'job-photos'
  AND public.is_member_of_dealership(public.extract_dealership_id_from_path(name))
);

-- Delete object: manager/owner only in dealership path
DROP POLICY IF EXISTS storage_job_photos_delete ON storage.objects;
CREATE POLICY storage_job_photos_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'job-photos'
  AND public.has_dealership_role(
    public.extract_dealership_id_from_path(name),
    ARRAY['owner', 'manager']::public.app_role[]
  )
);