-- ============================================================
-- RMIT Dispatch — migration 003
-- Per-account settings, and a cloud-persisted undo history.
-- Safe to re-run. Paste into the Supabase SQL editor.
-- ============================================================

-- ---------- Account settings ----------
create table if not exists public.user_settings (
  user_id    uuid primary key references public.profiles (uid) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_settings_updated on public.user_settings;
create trigger trg_user_settings_updated before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists user_settings_select on public.user_settings;
create policy user_settings_select on public.user_settings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_settings_insert on public.user_settings;
create policy user_settings_insert on public.user_settings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_settings_update on public.user_settings;
create policy user_settings_update on public.user_settings
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Undo history ----------
-- One row per undo step: only the new snapshot travels on each write,
-- and the history survives a reload or a move to another machine.
create table if not exists public.undo_entries (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id     uuid not null references public.profiles (uid) on delete cascade,
  seq         bigint not null,
  label       text not null default '',
  pages       jsonb not null,
  created_at  timestamptz not null default now(),
  unique (document_id, user_id, seq)
);

create index if not exists idx_undo_doc_user_seq
  on public.undo_entries (document_id, user_id, seq desc);

alter table public.undo_entries enable row level security;

-- A user's own history, and only for documents in a space they belong to.
drop policy if exists undo_select on public.undo_entries;
create policy undo_select on public.undo_entries
  for select to authenticated
  using (user_id = auth.uid() and public.is_space_member(public.document_space(document_id)));

drop policy if exists undo_insert on public.undo_entries;
create policy undo_insert on public.undo_entries
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_edit_space(public.document_space(document_id)));

drop policy if exists undo_delete on public.undo_entries;
create policy undo_delete on public.undo_entries
  for delete to authenticated using (user_id = auth.uid());
