import { newId } from '../lib/ids';
import { supabase } from '../lib/supabase';
import type { GridConfig, Page, Project } from '../types';
import { createDocument } from './documents';

function map(r: Record<string, unknown>): Project {
  return {
    id: r.id as string,
    spaceId: r.space_id as string,
    title: r.title as string,
    type: r.type as string,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
  };
}

export async function fetchProjects(spaceId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(map);
}

export async function fetchProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? map(data) : null;
}

/** Creates the project AND its master document with an empty draft. */
export async function createProject(args: {
  spaceId: string;
  title: string;
  type: string;
  grid: GridConfig;
  userId: string;
}): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      space_id: args.spaceId,
      title: args.title,
      type: args.type,
      created_by: args.userId,
    })
    .select()
    .single();
  if (error) throw error;
  const project = map(data);
  const firstPage: Page = { id: newId('pg'), index: 0, kind: 'single', blocks: [] };
  await createDocument({
    projectId: project.id,
    kind: 'master',
    title: args.title,
    grid: args.grid,
    userId: args.userId,
    pages: [firstPage],
  });
  return project;
}

export async function deleteProject(id: string) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function renameProject(id: string, title: string) {
  const { error } = await supabase.from('projects').update({ title }).eq('id', id);
  if (error) throw error;
}

export async function updateProjectMeta(id: string, patch: { title?: string; type?: string }) {
  const { error } = await supabase.from('projects').update(patch).eq('id', id);
  if (error) throw error;
}
