-- Bug reports and improvement requests, as a board the whole team shares.
--
-- Unlike every other table here, this one is deliberately NOT private per user:
-- a bug someone else already reported is worth seeing before reporting it
-- again, and the point of the statuses is that anyone can mark an item done
-- once it ships. It holds no patient data, which is what makes that safe — the
-- form says so, because the one way this table could hold health data is
-- someone pasting a note into a bug report.

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Snapshot of who reported it. A join to `profiles` would need a policy
  -- letting physicians read each other's rows; this needs no such opening.
  author_name text check (char_length(author_name) <= 120),
  kind        text not null check (kind in ('bug', 'improvement')),
  title       text not null check (char_length(trim(title)) between 1 and 120),
  detail      text check (char_length(detail) <= 4000),
  status      text not null default 'open'
                check (status in ('open', 'in_progress', 'done', 'discarded')),
  -- Browser and device string. "It looks wrong on my phone" is unfixable
  -- without knowing which phone.
  client      text check (char_length(client) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz
);

comment on table public.feedback is
  'Shared bug/improvement board. Readable by every authenticated physician.';

-- The board reads as "open items first, newest first".
create index if not exists feedback_status_created_idx
  on public.feedback (status, created_at desc);

-- Set by trigger rather than by the client: moving an item to done must not
-- require update privileges on a timestamp column.
create or replace function public.feedback_touch_resolved_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('done', 'discarded') and old.status not in ('done', 'discarded') then
    new.resolved_at = now();
  elsif new.status not in ('done', 'discarded') then
    new.resolved_at = null;
  end if;
  return new;
end;
$$;

revoke execute on function public.feedback_touch_resolved_at() from anon, authenticated, public;

drop trigger if exists feedback_touch_updated_at on public.feedback;
create trigger feedback_touch_updated_at
  before update on public.feedback
  for each row execute function public.touch_updated_at();

drop trigger if exists feedback_set_resolved_at on public.feedback;
create trigger feedback_set_resolved_at
  before update on public.feedback
  for each row execute function public.feedback_touch_resolved_at();

alter table public.feedback enable row level security;
alter table public.feedback force row level security;

-- Everyone logged in sees the whole board. This is the intended design, not an
-- oversight: it is a team issue tracker.
drop policy if exists "feedback: read all" on public.feedback;
create policy "feedback: read all" on public.feedback
  for select to authenticated using (true);

drop policy if exists "feedback: insert own" on public.feedback;
create policy "feedback: insert own" on public.feedback
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Anyone may move any item's status; the column grant below is what stops that
-- from also meaning "anyone may rewrite someone else's report".
drop policy if exists "feedback: update any" on public.feedback;
create policy "feedback: update any" on public.feedback
  for update to authenticated using (true) with check (true);

drop policy if exists "feedback: delete own" on public.feedback;
create policy "feedback: delete own" on public.feedback
  for delete to authenticated using ((select auth.uid()) = user_id);

-- RLS cannot express "only this column", so privileges do it. Column-level
-- grants are checked against the columns the statement names; the triggers
-- above still write updated_at and resolved_at.
revoke update on public.feedback from authenticated;
grant update (status) on public.feedback to authenticated;
