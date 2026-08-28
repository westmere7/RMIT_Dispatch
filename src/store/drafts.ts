import { supabase } from '../lib/supabase';
import type { Draft, Page } from '../types';
import { foldHeadings } from '../lib/blocks';

export function mapDraft(r: Record<string, unknown>): Draft {
  return {
    documentId: r.document_id as string,
    // Legacy heading fields fold into the body on the way in.
    pages: foldHeadings((r.pages as Page[]) ?? []),
    updatedAt: r.updated_at as string,
    updatedBy: (r.updated_by as string) ?? '',
  };
}

export async function fetchDraft(documentId: string): Promise<Draft | null> {
  const { data, error } = await supabase
    .from('drafts')
    .select('*')
    .eq('document_id', documentId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapDraft(data) : null;
}

/** First page of each requested draft (for card/list thumbnails). */
export async function fetchFirstPages(documentIds: string[]): Promise<Map<string, Page | undefined>> {
  if (documentIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('drafts')
    .select('document_id, pages')
    .in('document_id', documentIds);
  if (error) throw error;
  return new Map(
    (data ?? []).map((r) => [r.document_id as string, foldHeadings(r.pages as Page[])[0]]),
  );
}

export async function saveDraft(documentId: string, pages: Page[], userId: string): Promise<void> {
  const { error } = await supabase
    .from('drafts')
    .update({ pages, updated_by: userId })
    .eq('document_id', documentId);
  if (error) throw error;
}

/**
 * Like `saveDraft`, but reports whether the row was actually written.
 *
 * The drafts UPDATE policy refuses a document someone else holds a live
 * lock on, and PostgREST reports that as ZERO ROWS, not as an error — so
 * a dispatch would otherwise claim to have delivered content that never
 * landed. Asking for the updated rows back is what makes the refusal
 * visible.
 */
export async function saveDraftIfWritable(
  documentId: string,
  pages: Page[],
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('drafts')
    .update({ pages, updated_by: userId })
    .eq('document_id', documentId)
    .select('document_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}
