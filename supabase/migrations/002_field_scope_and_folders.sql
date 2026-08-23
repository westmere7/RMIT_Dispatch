-- ============================================================
-- RMIT Dispatch — migration 002
-- Sync fields gain scope (local | global) and folder organisation.
-- Safe to re-run. Paste into the Supabase SQL editor.
-- ============================================================

alter table public.sync_fields add column if not exists space_id uuid references public.spaces (id) on delete cascade;
alter table public.sync_fields add column if not exists scope  text not null default 'local';
alter table public.sync_fields add column if not exists folder text not null default '';
alter table public.sync_fields alter column project_id drop not null;

-- Existing rows are project-local; derive their space from the project.
update public.sync_fields f
   set space_id = p.space_id
  from public.projects p
 where f.project_id = p.id and f.space_id is null;

do $$
begin
  alter table public.sync_fields
    add constraint sync_fields_scope_check check (scope in ('local', 'global'));
exception when duplicate_object then null;
end $$;

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

create index if not exists idx_sync_fields_space on public.sync_fields (space_id);
create index if not exists idx_sync_fields_scope on public.sync_fields (space_id, scope);

-- Policies now key off space_id, which is set for both scopes.
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
