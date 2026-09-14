-- Patients under a physician's care, for inpatients seen over several days.
--
-- Identity here is deliberately minimal: initials and a bed. Formal
-- identification lives in the hospital's own record, which is where it belongs;
-- this table only needs to be enough for the physician to recognise who they
-- are standing in front of. The length limit on initials enforces that rather
-- than merely suggesting it — a full name does not fit.

create table if not exists public.patients (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  initials      text not null check (char_length(trim(initials)) between 1 and 16),
  bed           text check (char_length(bed) <= 32),
  admitted_on   date,
  -- Reason for admission. Clinical, but without it the list is unusable.
  reason        text check (char_length(reason) <= 300),
  -- Null means still under care; a timestamp means discharged.
  discharged_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.patients is
  'Inpatients a physician is following. Minimal identity by design.';

-- The list is almost always "who is still admitted, most recent first".
create index if not exists patients_user_active_idx
  on public.patients (user_id, discharged_at, created_at desc);

-- A consultation may belong to a patient, or stand alone as it did before.
alter table public.consultations
  add column if not exists patient_id uuid references public.patients (id) on delete cascade;

create index if not exists consultations_patient_idx
  on public.consultations (patient_id, created_at desc);

drop trigger if exists patients_touch_updated_at on public.patients;
create trigger patients_touch_updated_at
  before update on public.patients
  for each row execute function public.touch_updated_at();

alter table public.patients enable row level security;
alter table public.patients force row level security;

drop policy if exists "patients: read own" on public.patients;
create policy "patients: read own" on public.patients
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "patients: insert own" on public.patients;
create policy "patients: insert own" on public.patients
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "patients: update own" on public.patients;
create policy "patients: update own" on public.patients
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "patients: delete own" on public.patients;
create policy "patients: delete own" on public.patients
  for delete to authenticated using ((select auth.uid()) = user_id);
