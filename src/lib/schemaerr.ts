/**
 * Detects the "column does not exist" error Postgres raises when the app
 * is newer than the database, so the UI can point at the migration
 * instead of failing silently.
 */
export function isMissingColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = e?.message ?? '';
  return (
    // Postgres itself.
    e?.code === '42703' ||
    // PostgREST rejects the write before Postgres sees it, using its own
    // code and wording ("Could not find the 'flag' column ... in the
    // schema cache"), so both spellings have to be recognised.
    e?.code === 'PGRST204' ||
    /does not exist/i.test(msg) ||
    /could not find the .* column/i.test(msg)
  );
}

export const MIGRATION_HINT =
  'The database is missing the field scope/folder columns. Run supabase/migrations/002_field_scope_and_folders.sql in the Supabase SQL editor, then reload.';

export const PROJECT_MIGRATION_HINT =
  'The database is missing the project folder/flag columns. Run supabase/migrations/004_project_folders_and_flags.sql in the Supabase SQL editor, then reload.';
