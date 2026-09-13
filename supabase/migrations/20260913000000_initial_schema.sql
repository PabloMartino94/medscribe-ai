-- MedScribe AI — initial schema.
--
-- Every table is owned by exactly one physician (auth.users.id) and is
-- unreadable by anyone else: RLS is forced on, and each policy compares
-- user_id against auth.uid(). The API server never uses the service-role key
-- for these tables — it acts with the caller's own access token, so a bug in
-- application code still cannot read another physician's rows.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  -- Standing style instructions applied to every note this physician generates.
  preferences text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'One row per physician. Holds non-clinical settings only.';

-- ---------------------------------------------------------------------------
-- consultations
-- ---------------------------------------------------------------------------

create table if not exists public.consultations (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  -- Free-text label the physician picks to recognise the encounter.
  patient_ref            text,
  template               text not null
                           check (template in ('soap', 'evolucion', 'informe', 'receta')),
  title                  text not null,
  sections               jsonb not null default '[]'::jsonb,
  plain_text             text not null,
  anonymized             boolean not null default false,
  transcript             text,
  -- Object key in the private `recordings` bucket, always '<user_id>/...'.
  audio_path             text,
  audio_duration_seconds numeric,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.consultations is
  'Structured clinical notes. Contains health data — never expose without RLS.';

create index if not exists consultations_user_created_idx
  on public.consultations (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists consultations_touch_updated_at on public.consultations;
create trigger consultations_touch_updated_at
  before update on public.consultations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- profile bootstrap
-- ---------------------------------------------------------------------------

-- Runs as definer because auth.users triggers execute outside the new user's
-- session, so auth.uid() is not yet available to satisfy the insert policy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.profiles      force row level security;
alter table public.consultations enable row level security;
alter table public.consultations force row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "consultations: read own" on public.consultations;
create policy "consultations: read own" on public.consultations
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "consultations: insert own" on public.consultations;
create policy "consultations: insert own" on public.consultations
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "consultations: update own" on public.consultations;
create policy "consultations: update own" on public.consultations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "consultations: delete own" on public.consultations;
create policy "consultations: delete own" on public.consultations
  for delete to authenticated using ((select auth.uid()) = user_id);
