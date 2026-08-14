-- Simple List v1.2.2
-- Isolated table and policy names prevent collisions with other bnaimitzvah apps.

create table if not exists public.simplist_items_v1 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 250),
  notes_html text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists simplist_items_v1_user_title_idx
  on public.simplist_items_v1 (user_id, lower(title));

alter table public.simplist_items_v1 enable row level security;

drop policy if exists "simplist_items_v1_owner_access" on public.simplist_items_v1;
create policy "simplist_items_v1_owner_access"
  on public.simplist_items_v1
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.simplist_items_v1 from anon;
grant select, insert, update, delete on table public.simplist_items_v1 to authenticated;
