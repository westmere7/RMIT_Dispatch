import { supabase } from '../lib/supabase';
import type { DispatchDocument, DocumentKind, GridConfig, Page } from '../types';

export function mapDocument(r: Record<string, unknown>): DispatchDocument {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    kind: r.kind as DocumentKind,
    parentId: (r.parent_id as string | null) ?? null,
    title: r.title as string,
    grid: r.grid as GridConfig,
    status: (r.status as 'draft' | 'final') ?? 'draft',
    currentVersionId: (r.current_version_id as string | null) ?? null,
    versionCount: (r.version_count as number) ?? 0,
    lock: r.lock_uid
      ? {
          uid: r.lock_uid as string,
          displayName: (r.lock_name as string) ?? '',
          at: (r.lock_at as string) ?? '',
        }
      : null,
  };
}

export async function fetchDocuments(projectId: string): Promise<DispatchDocument[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapDocument);
}

export async function fetchDocumentsForProjects(projectIds: string[]): Promise<DispatchDocument[]> {
  if (projectIds.length === 0) return [];
  const { data, error } = await supabase.from('documents').select('*').in('project_id', projectIds);
  if (error) throw error;
  return (data ?? []).map(mapDocument);
}

export async function fetchDocument(id: string): Promise<DispatchDocument | null> {
  const { data, error } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapDocument(data) : null;
}

export async function createDocument(args: {
  projectId: string;
  kind: DocumentKind;
  parentId?: string;
  title: string;
  grid: GridConfig;
  userId: string;
  pages?: Page[];
}): Promise<DispatchDocument> {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      project_id: args.projectId,
      kind: args.kind,
      parent_id: args.parentId ?? null,
      title: args.title,
      grid: args.grid,
    })
    .select()
    .single();
  if (error) throw error;
  const doc = mapDocument(data);
  const { error: dErr } = await supabase.from('drafts').insert({
    document_id: doc.id,
    pages: args.pages ?? [],
    updated_by: args.userId,
  });
  if (dErr) throw dErr;
  return doc;
}

export async function updateDocumentMeta(
  id: string,
  patch: Partial<{ title: string; grid: GridConfig; parentId: string | null }>,
) {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.grid !== undefined) row.grid = patch.grid;
  if (patch.parentId !== undefined) row.parent_id = patch.parentId;
  const { error } = await supabase.from('documents').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteDocument(id: string) {
  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- Locking ----------
   RLS only allows this update when the lock is free, ours, or stale,
   so a plain update is race-safe enough for this app. */

export async function acquireLock(docId: string, uid: string, displayName: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('documents')
    .update({ lock_uid: uid, lock_name: displayName, lock_at: new Date().toISOString() })
    .eq('id', docId)
    .select('lock_uid')
    .maybeSingle();
  if (error) return false;
  return data?.lock_uid === uid;
}

export async function heartbeatLock(docId: string, uid: string) {
  await supabase
    .from('documents')
    .update({ lock_at: new Date().toISOString() })
    .eq('id', docId)
    .eq('lock_uid', uid);
}

export async function releaseLock(docId: string, uid: string) {
  await supabase
    .from('documents')
    .update({ lock_uid: null, lock_name: null, lock_at: null })
    .eq('id', docId)
    .eq('lock_uid', uid);
}

export async function bumpVersionPointer(docId: string, versionId: string, versionCount: number) {
  const { error } = await supabase
    .from('documents')
    .update({ current_version_id: versionId, version_count: versionCount })
    .eq('id', docId);
  if (error) throw error;
}
