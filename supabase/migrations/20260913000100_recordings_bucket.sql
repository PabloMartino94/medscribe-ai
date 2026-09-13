-- Private bucket for consultation recordings.
--
-- Objects are keyed '<user_id>/<consultation_id>.<ext>', and every policy
-- checks that the first path segment equals auth.uid(). The bucket is not
-- public, so the only way to play a recording back is a short-lived signed URL
-- the API mints for its owner.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings',
  'recordings',
  false,
  52428800, -- 50 MB, matching the upload limit enforced by the API
  array[
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3',
    'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/x-wav'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "recordings: read own" on storage.objects;
create policy "recordings: read own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "recordings: insert own" on storage.objects;
create policy "recordings: insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "recordings: update own" on storage.objects;
create policy "recordings: update own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "recordings: delete own" on storage.objects;
create policy "recordings: delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
