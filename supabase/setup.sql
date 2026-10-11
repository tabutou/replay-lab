-- Replay Lab v0.2: cloud save for chart practice
-- Run once in Supabase Dashboard > SQL Editor
create table if not exists public.replay_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  dataset_key text not null,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, dataset_key)
);

alter table public.replay_sessions enable row level security;

revoke all on public.replay_sessions from anon;
grant select, insert, update, delete on public.replay_sessions to authenticated;

drop policy if exists "replay_select_own" on public.replay_sessions;
drop policy if exists "replay_insert_own" on public.replay_sessions;
drop policy if exists "replay_update_own" on public.replay_sessions;
drop policy if exists "replay_delete_own" on public.replay_sessions;

create policy "replay_select_own"
on public.replay_sessions for select to authenticated
using ((select auth.uid()) = user_id);

create policy "replay_insert_own"
on public.replay_sessions for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "replay_update_own"
on public.replay_sessions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "replay_delete_own"
on public.replay_sessions for delete to authenticated
using ((select auth.uid()) = user_id);

-- No privileges for anonymous visitors; all authenticated users
-- can only access their own rows due to RLS.
