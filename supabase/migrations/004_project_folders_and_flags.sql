-- ============================================================
-- RMIT Dispatch — migration 004
-- Project organisation: folders (a '/'-separated path, like sync
-- fields) and a colour flag. Safe to re-run.
-- ============================================================

alter table public.projects add column if not exists folder text not null default '';
alter table public.projects add column if not exists flag text;

do $$
begin
  alter table public.projects
    add constraint projects_flag_check
    check (flag is null or flag in ('red', 'amber', 'green', 'blue', 'purple', 'grey'));
exception when duplicate_object then null;
end $$;

create index if not exists idx_projects_folder on public.projects (space_id, folder);
