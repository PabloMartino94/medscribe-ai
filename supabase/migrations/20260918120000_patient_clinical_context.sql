-- Clinical context for a patient, so an evolution note is not written blind.
--
-- The model only ever knew what was said out loud during the encounter. Nobody
-- dictates "paciente de 72 años, alérgico a penicilina" on the fourth day of an
-- admission — it is already known — so those facts were missing from every
-- note. These columns hold them once, and the structuring prompt receives them
-- as background for every note written about this patient.
--
-- Identity stays minimal on purpose: this adds clinical facts, not identifiers.
-- Age rather than a date of birth, because age is what the note actually says
-- and a birth date plus initials plus a ward narrows a person down sharply.

alter table public.patients
  -- 130 is past the verified human record; anything beyond it is a typo.
  add column if not exists age_years  smallint check (age_years between 0 and 130),
  add column if not exists sex        text     check (sex in ('F', 'M', 'X')),
  -- Dosing depends on it, so it is worth a column of its own rather than prose.
  add column if not exists weight_kg  numeric(5,1) check (weight_kg > 0 and weight_kg < 700),
  -- The active problem being treated, as opposed to `reason`, which is what
  -- brought them in. On day one they coincide; by day four they rarely do.
  add column if not exists diagnosis   text check (char_length(diagnosis) <= 300),
  add column if not exists history     text check (char_length(history) <= 2000),
  add column if not exists allergies   text check (char_length(allergies) <= 500),
  add column if not exists medications text check (char_length(medications) <= 2000);

comment on column public.patients.sex is
  'F, M or X. Clinically relevant (reference ranges, dosing), not an identifier.';
comment on column public.patients.diagnosis is
  'Active problem under treatment. `reason` is the complaint at admission.';
comment on column public.patients.history is
  'Past medical history: comorbidities, surgeries, habits.';
comment on column public.patients.allergies is
  'Known allergies. Safety critical — surfaced in every note context.';
comment on column public.patients.medications is
  'Home and current medication.';
