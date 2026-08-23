import { stripMarks } from '../lib/richtext';
import { supabase } from '../lib/supabase';
import type { FieldScope, FieldValue, SyncField } from '../types';

/**
 * Single choke point for field values: strip character formatting so no
 * field ever stores bold/italic/colour, while keeping structure — nested
 * field spans and table shape survive untouched.
 */
function plainValue(value: FieldValue): FieldValue {
  if (value.kind === 'richtext') return { kind: 'richtext', rich: stripMarks(value.rich) };
  if (value.kind === 'table') {
    return {
      kind: 'table',
      headerRow: value.headerRow,
      rows: value.rows.map((row) => row.map((cell) => stripMarks(cell))),
    };
  }
  return value;
}

export function mapField(r: Record<string, unknown>): SyncField {
  return {
    id: r.id as string,
    projectId: (r.project_id as string | null) ?? null,
    spaceId: (r.space_id as string) ?? '',
    scope: ((r.scope as FieldScope) ?? 'local'),
    folder: (r.folder as string) ?? '',
    name: r.name as string,
    value: r.value as FieldValue,
    updatedAt: r.updated_at as string,
    updatedBy: (r.updated_by as string) ?? '',
  };
}

const sortFields = (a: SyncField, b: SyncField) =>
  a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name);

/**
 * Every field usable inside a project: its own local fields plus all the
 * space's global ones. One query — space_id is set on both kinds.
 */
export async function fetchFieldsForProject(
  projectId: string,
  spaceId: string,
): Promise<SyncField[]> {
  const { data, error } = await supabase
    .from('sync_fields')
    .select('*')
    .eq('space_id', spaceId)
    .or(`scope.eq.global,project_id.eq.${projectId}`);
  if (error) throw error;
  return (data ?? []).map(mapField).sort(sortFields);
}

/** Global (space-wide) fields only — for the external manager page. */
export async function fetchGlobalFields(spaceId: string): Promise<SyncField[]> {
  const { data, error } = await supabase
    .from('sync_fields')
    .select('*')
    .eq('space_id', spaceId)
    .eq('scope', 'global');
  if (error) throw error;
  return (data ?? []).map(mapField).sort(sortFields);
}

/** Every field in the space, local ones included (manager "all" view). */
export async function fetchAllSpaceFields(spaceId: string): Promise<SyncField[]> {
  const { data, error } = await supabase
    .from('sync_fields')
    .select('*')
    .eq('space_id', spaceId);
  if (error) throw error;
  return (data ?? []).map(mapField).sort(sortFields);
}

/** Project titles for showing where local fields live. */
export async function fetchProjectTitles(spaceId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, title')
    .eq('space_id', spaceId);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.id as string, r.title as string]));
}

export async function createField(args: {
  id?: string;
  projectId: string | null;
  spaceId: string;
  scope?: FieldScope;
  folder?: string;
  name: string;
  value: FieldValue;
  userId: string;
}): Promise<SyncField> {
  const scope = args.scope ?? 'local';
  const { data, error } = await supabase
    .from('sync_fields')
    .insert({
      ...(args.id ? { id: args.id } : {}),
      // A global field belongs to the space, not to any one project.
      project_id: scope === 'global' ? null : args.projectId,
      space_id: args.spaceId,
      scope,
      folder: args.folder ?? '',
      name: args.name,
      value: plainValue(args.value),
      updated_by: args.userId,
    })
    .select()
    .single();
  if (error) throw error;
  return mapField(data);
}

export async function updateFieldValue(id: string, value: FieldValue, userId: string) {
  const { error } = await supabase
    .from('sync_fields')
    .update({ value: plainValue(value), updated_by: userId })
    .eq('id', id);
  if (error) throw error;
}

export async function renameField(id: string, name: string) {
  const { error } = await supabase.from('sync_fields').update({ name }).eq('id', id);
  if (error) throw error;
}

/** Move a field between folders (folder is a plain '/'-separated path). */
export async function setFieldFolder(id: string, folder: string) {
  const { error } = await supabase.from('sync_fields').update({ folder }).eq('id', id);
  if (error) throw error;
}

/**
 * Promote a local field to global, or pull a global field back into one
 * project. The scope/project_id pair is constrained in the database, so
 * both columns move together.
 */
export async function setFieldScope(id: string, scope: FieldScope, projectId: string | null) {
  const { error } = await supabase
    .from('sync_fields')
    .update({ scope, project_id: scope === 'global' ? null : projectId })
    .eq('id', id);
  if (error) throw error;
}

/** Rename a whole folder subtree for the given fields. */
export async function renameFolder(
  fields: SyncField[],
  oldPath: string,
  newPath: string,
): Promise<void> {
  const affected = fields.filter((f) => f.folder === oldPath || f.folder.startsWith(`${oldPath}/`));
  await Promise.all(
    affected.map((f) => setFieldFolder(f.id, newPath + f.folder.slice(oldPath.length))),
  );
}

export async function deleteField(id: string) {
  const { error } = await supabase.from('sync_fields').delete().eq('id', id);
  if (error) throw error;
}
