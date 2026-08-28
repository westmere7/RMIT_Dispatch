-- ============================================================
-- RMIT Dispatch — full Supabase schema + RLS
-- Paste into the Supabase SQL editor (safe to re-run).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Profiles (mirror of auth.users) ----------
create table if not exists public.profiles (
  uid          uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null default '',
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (uid, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (uid) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Core tables ----------
create table if not exists public.spaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references public.profiles (uid),
  created_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id   uuid not null references public.spaces (id) on delete cascade,
  user_id    uuid not null references public.profiles (uid) on delete cascade,
  role       text not null check (role in ('admin', 'editor', 'designer')),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  title      text not null,
  type       text not null default '',
  created_by uuid not null references public.profiles (uid),
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  kind               text not null check (kind in ('master', 'adaptation')),
  parent_id          uuid references public.documents (id) on delete set null,
  title              text not null,
  grid               jsonb not null,
  status             text not null default 'draft' check (status in ('draft', 'final')),
  current_version_id uuid,
  version_count      integer not null default 0,
  lock_uid           uuid,
  lock_name          text,
  lock_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.drafts (
  document_id uuid primary key references public.documents (id) on delete cascade,
  pages       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table if not exists public.versions (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  number          integer not null,
  label           text,
  created_by      uuid not null references public.profiles (uid),
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  snapshot        jsonb not null
);

-- Sync fields are either LOCAL to one project or GLOBAL to a whole space
-- (shared by every project in it). space_id is always set so policies and
-- realtime filters need only one column. `folder` is a '/'-separated path
-- used purely for organisation.
create table if not exists public.sync_fields (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  space_id   uuid references public.spaces (id) on delete cascade,
  scope      text not null default 'local' check (scope in ('local', 'global')),
  folder     text not null default '',
  name       text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Upgrade an existing installation in place.
alter table public.sync_fields add column if not exists space_id uuid references public.spaces (id) on delete cascade;
alter table public.sync_fields add column if not exists scope  text not null default 'local';
alter table public.sync_fields add column if not exists folder text not null default '';
alter table public.sync_fields alter column project_id drop not null;

-- Backfill space_id for rows created before the column existed.
update public.sync_fields f
   set space_id = p.space_id
  from public.projects p
 where f.project_id = p.id and f.space_id is null;

do $$
begin
  alter table public.sync_fields
    add constraint sync_fields_scope_shape
    check (
      (scope = 'local'  and project_id is not null) or
      (scope = 'global' and project_id is null)
    );
exception when duplicate_object then null;
end $$;

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  block_id    text,
  body        text not null,
  author_id   uuid not null references public.profiles (uid),
  author_name text not null default '',
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- Indexes ----------
create index if not exists idx_space_members_user on public.space_members (user_id);
create index if not exists idx_projects_space     on public.projects (space_id);
create index if not exists idx_documents_project  on public.documents (project_id);
create index if not exists idx_documents_parent   on public.documents (parent_id);
create index if not exists idx_versions_document  on public.versions (document_id);
create index if not exists idx_sync_fields_project on public.sync_fields (project_id);
create index if not exists idx_sync_fields_space   on public.sync_fields (space_id);
create index if not exists idx_sync_fields_scope   on public.sync_fields (space_id, scope);
create index if not exists idx_comments_document  on public.comments (document_id);

-- ---------- updated_at triggers ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_documents_updated on public.documents;
create trigger trg_documents_updated before update on public.documents
  for each row execute function public.set_updated_at();

drop trigger if exists trg_drafts_updated on public.drafts;
create trigger trg_drafts_updated before update on public.drafts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sync_fields_updated on public.sync_fields;
create trigger trg_sync_fields_updated before update on public.sync_fields
  for each row execute function public.set_updated_at();

-- ---------- Access helper functions ----------
-- SECURITY DEFINER so policies (especially on space_members itself)
-- never recurse through RLS.
create or replace function public.is_space_member(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from space_members
    where space_id = sid and user_id = auth.uid()
  );
$$;

create or replace function public.space_role(sid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from space_members
  where space_id = sid and user_id = auth.uid();
$$;

create or replace function public.can_edit_space(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.space_role(sid) in ('admin', 'editor'), false);
$$;

create or replace function public.project_space(pid uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select space_id from projects where id = pid;
$$;

create or replace function public.document_space(did uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.space_id from documents d join projects p on p.id = d.project_id
  where d.id = did;
$$;

-- Lock state of a document: 'mine' | 'free' | 'stale' | 'held'
create or replace function public.doc_lock_state(did uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when d.lock_uid is null then 'free'
    when d.lock_uid = auth.uid() then 'mine'
    when d.lock_at < now() - interval '2 minutes' then 'stale'
    else 'held'
  end
  from documents d where d.id = did;
$$;

-- ---------- RLS ----------
alter table public.profiles      enable row level security;
alter table public.spaces        enable row level security;
alter table public.space_members enable row level security;
alter table public.projects      enable row level security;
alter table public.documents     enable row level security;
alter table public.drafts        enable row level security;
alter table public.versions      enable row level security;
alter table public.sync_fields   enable row level security;
alter table public.comments      enable row level security;

-- profiles: any signed-in user can look up profiles (member invites by
-- email); only the owner updates their own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (uid = auth.uid()) with check (uid = auth.uid());

-- spaces
drop policy if exists spaces_select on public.spaces;
create policy spaces_select on public.spaces
  for select to authenticated
  using (public.is_space_member(id) or created_by = auth.uid());

drop policy if exists spaces_insert on public.spaces;
create policy spaces_insert on public.spaces
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists spaces_update on public.spaces;
create policy spaces_update on public.spaces
  for update to authenticated
  using (public.space_role(id) = 'admin') with check (public.space_role(id) = 'admin');

drop policy if exists spaces_delete on public.spaces;
create policy spaces_delete on public.spaces
  for delete to authenticated using (public.space_role(id) = 'admin');

-- space_members: members can see the roster; admins manage it; the space
-- creator bootstraps their own admin membership; anyone may leave.
drop policy if exists space_members_select on public.space_members;
create policy space_members_select on public.space_members
  for select to authenticated using (public.is_space_member(space_id));

drop policy if exists space_members_insert on public.space_members;
create policy space_members_insert on public.space_members
  for insert to authenticated
  with check (
    public.space_role(space_id) = 'admin'
    or (
      user_id = auth.uid() and role = 'admin'
      and exists (select 1 from public.spaces s where s.id = space_id and s.created_by = auth.uid())
    )
  );

drop policy if exists space_members_update on public.space_members;
create policy space_members_update on public.space_members
  for update to authenticated
  using (public.space_role(space_id) = 'admin')
  with check (public.space_role(space_id) = 'admin');

drop policy if exists space_members_delete on public.space_members;
create policy space_members_delete on public.space_members
  for delete to authenticated
  using (public.space_role(space_id) = 'admin' or user_id = auth.uid());

-- projects
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated using (public.is_space_member(space_id));

drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects
  for insert to authenticated with check (public.can_edit_space(space_id));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (public.can_edit_space(space_id)) with check (public.can_edit_space(space_id));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated using (public.can_edit_space(space_id));

-- documents: editors write; updates additionally require the lock to be
-- free, yours, or stale (stale-lock takeover is enforced server-side).
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated using (public.is_space_member(public.project_space(project_id)));

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated with check (public.can_edit_space(public.project_space(project_id)));

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (
    public.can_edit_space(public.project_space(project_id))
    and public.doc_lock_state(id) in ('free', 'mine', 'stale')
  )
  with check (public.can_edit_space(public.project_space(project_id)));

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated using (public.can_edit_space(public.project_space(project_id)));

-- drafts: readable by members; writable by editors, and never while
-- someone ELSE holds a live lock on the document.
drop policy if exists drafts_select on public.drafts;
create policy drafts_select on public.drafts
  for select to authenticated using (public.is_space_member(public.document_space(document_id)));

drop policy if exists drafts_insert on public.drafts;
create policy drafts_insert on public.drafts
  for insert to authenticated
  with check (public.can_edit_space(public.document_space(document_id)));

drop policy if exists drafts_update on public.drafts;
create policy drafts_update on public.drafts
  for update to authenticated
  using (
    public.can_edit_space(public.document_space(document_id))
    and public.doc_lock_state(document_id) in ('free', 'mine', 'stale')
  )
  with check (public.can_edit_space(public.document_space(document_id)));

-- versions: immutable snapshots.
drop policy if exists versions_select on public.versions;
create policy versions_select on public.versions
  for select to authenticated using (public.is_space_member(public.document_space(document_id)));

drop policy if exists versions_insert on public.versions;
create policy versions_insert on public.versions
  for insert to authenticated
  with check (
    public.can_edit_space(public.document_space(document_id)) and created_by = auth.uid()
  );

-- sync_fields: keyed on space_id (always set), so one rule covers both
-- local and global fields.
drop policy if exists sync_fields_select on public.sync_fields;
create policy sync_fields_select on public.sync_fields
  for select to authenticated using (public.is_space_member(space_id));

drop policy if exists sync_fields_insert on public.sync_fields;
create policy sync_fields_insert on public.sync_fields
  for insert to authenticated with check (public.can_edit_space(space_id));

drop policy if exists sync_fields_update on public.sync_fields;
create policy sync_fields_update on public.sync_fields
  for update to authenticated
  using (public.can_edit_space(space_id))
  with check (public.can_edit_space(space_id));

drop policy if exists sync_fields_delete on public.sync_fields;
create policy sync_fields_delete on public.sync_fields
  for delete to authenticated using (public.can_edit_space(space_id));

-- comments: every member (designers included) can comment and resolve;
-- authors and admins can delete.
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated using (public.is_space_member(public.document_space(document_id)));

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    public.is_space_member(public.document_space(document_id)) and author_id = auth.uid()
  );

drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
  for update to authenticated
  using (public.is_space_member(public.document_space(document_id)))
  with check (public.is_space_member(public.document_space(document_id)));

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (
    author_id = auth.uid()
    or public.space_role(public.document_space(document_id)) = 'admin'
  );

-- ---------- Realtime ----------
-- Full replica identity so DELETE/UPDATE events carry filterable columns.
alter table public.drafts      replica identity full;
alter table public.sync_fields replica identity full;
alter table public.comments    replica identity full;
alter table public.documents   replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.drafts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.sync_fields;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.comments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.documents;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------- Storage: media bucket ----------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "media upload" on storage.objects;
create policy "media upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');

drop policy if exists "media update" on storage.objects;
create policy "media update" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and owner = auth.uid());

drop policy if exists "media delete" on storage.objects;
create policy "media delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and owner = auth.uid());

-- ---------- Publication Shares ----------
create table if not exists public.shares (
  id              uuid primary key default gen_random_uuid(),
  token           text unique not null default encode(gen_random_bytes(16), 'hex'),
  document_id     uuid not null references public.documents (id) on delete cascade,
  version_id      uuid references public.versions (id) on delete set null,
  version_number  integer,
  created_by      uuid not null references public.profiles (uid),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  require_login   boolean not null default false,
  allow_copy      boolean not null default true
);

alter table public.shares enable row level security;

drop policy if exists "Space members can manage shares" on public.shares;
create policy "Space members can manage shares"
  on public.shares
  for all
  using (
    exists (
      select 1 from public.documents d
      join public.projects p on p.id = d.project_id
      join public.space_members sm on sm.space_id = p.space_id
      where d.id = shares.document_id and sm.user_id = auth.uid()
    )
  );

drop policy if exists "Public can read active shares" on public.shares;
create policy "Public can read active shares"
  on public.shares
  for select
  using (expires_at is null or expires_at > now());

