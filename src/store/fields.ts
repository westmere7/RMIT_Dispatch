import { supabase } from '../lib/supabase';
import type { FieldValue, SyncField } from '../types';

export function mapField(r: Record<string, unknown>): SyncField {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    value: r.value as FieldValue,
    updatedAt: r.updated_at as string,
    updatedBy: (r.updated_by as string) ?? '',
  };
}

export async function fetchFields(projectId: string): Promise<SyncField[]> {
  const { data, error } = await supabase
    .from('sync_fields')
    .select('*')
    .eq('project_id', projectId)
    .order('name');
  if (error) throw error;
  return (data ?? []).map(mapField);
}

export async function createField(args: {
  id?: string;
  projectId: string;
  name: string;
  value: FieldValue;
  userId: string;
}): Promise<SyncField> {
  const { data, error } = await supabase
    .from('sync_fields')
    .insert({
      ...(args.id ? { id: args.id } : {}),
      project_id: args.projectId,
      name: args.name,
      value: args.value,
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
    .update({ value, updated_by: userId })
    .eq('id', id);
  if (error) throw error;
}

export async function renameField(id: string, name: string) {
  const { error } = await supabase.from('sync_fields').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteField(id: string) {
  const { error } = await supabase.from('sync_fields').delete().eq('id', id);
  if (error) throw error;
}
