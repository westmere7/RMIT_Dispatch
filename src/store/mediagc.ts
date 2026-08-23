import { pageMediaPaths } from '../lib/syncfields';
import { valueMediaPaths } from '../lib/syncfields';
import { supabase } from '../lib/supabase';
import type { FieldValue, Page } from '../types';
import { deleteMediaMany } from './media';

/**
 * Every storage path still referenced anywhere in a project: by any
 * document's draft, or by any field the project can see (its own plus the
 * space's global ones).
 *
 * Cloned and unlinked documents share paths with the document they came
 * from, so a file may only be deleted once NOTHING points at it. Guessing
 * from a single edit would break images in sibling documents.
 */
export async function collectProjectMediaRefs(
  projectId: string,
  spaceId: string,
): Promise<Set<string>> {
  const refs = new Set<string>();

  const { data: docs } = await supabase.from('documents').select('id').eq('project_id', projectId);
  const ids = (docs ?? []).map((d) => d.id as string);
  if (ids.length) {
    const { data: drafts } = await supabase.from('drafts').select('pages').in('document_id', ids);
    for (const row of drafts ?? []) {
      for (const p of pageMediaPaths((row.pages as Page[]) ?? [])) refs.add(p);
    }
  }

  const { data: fields } = await supabase
    .from('sync_fields')
    .select('value')
    .eq('space_id', spaceId);
  for (const row of fields ?? []) {
    for (const p of valueMediaPaths(row.value as FieldValue)) refs.add(p);
  }

  return refs;
}

/**
 * Delete the given paths, but only those nothing references any more.
 * Called after a save so orphans do not accumulate in the bucket.
 */
export async function gcMedia(
  projectId: string,
  spaceId: string,
  candidates: string[],
): Promise<string[]> {
  const unique = [...new Set(candidates.filter(Boolean))];
  if (unique.length === 0) return [];
  try {
    const refs = await collectProjectMediaRefs(projectId, spaceId);
    const orphans = unique.filter((p) => !refs.has(p));
    if (orphans.length) await deleteMediaMany(orphans);
    return orphans;
  } catch (e) {
    console.warn('media gc skipped', (e as Error).message);
    return [];
  }
}
