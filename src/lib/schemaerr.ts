/**
 * Detects the "column does not exist" error Postgres raises when the app
 * is newer than the database, so the UI can point at the migration
 * instead of failing silently.
 */
export function isMissingColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '42703' || /does not exist/i.test(e?.message ?? '');
}

export const MIGRATION_HINT =
  'The database is missing the field scope/folder columns. Run supabase/migrations/002_field_scope_and_folders.sql in the Supabase SQL editor, then reload.';
