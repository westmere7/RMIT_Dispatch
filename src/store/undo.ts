import { supabase } from '../lib/supabase';
import type { Page } from '../types';

/* ============================================================
   Cloud-persisted undo history. One row per step, so each edit
   sends only its own snapshot — and the history is still there
   after a reload or on another machine.
   ============================================================ */

export interface UndoEntry {
  seq: number;
  label: string;
  pages: Page[];
}

/** Newest-last history for this user and document, capped at `limit`. */
export async function fetchUndoHistory(
  documentId: string,
  userId: string,
  limit: number,
): Promise<UndoEntry[]> {
  const { data, error } = await supabase
    .from('undo_entries')
    .select('seq, label, pages')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .order('seq', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({ seq: Number(r.seq), label: (r.label as string) ?? '', pages: r.pages as Page[] }))
    .reverse();
}

/** Append a step. Returns the seq written. */
export async function pushUndoEntry(args: {
  documentId: string;
  userId: string;
  seq: number;
  label: string;
  pages: Page[];
}): Promise<void> {
  const { error } = await supabase.from('undo_entries').insert({
    document_id: args.documentId,
    user_id: args.userId,
    seq: args.seq,
    label: args.label,
    pages: args.pages,
  });
  if (error) throw error;
}

/**
 * Drop everything above `seq` — the redo branch, discarded when a new
 * edit is made after undoing.
 */
export async function truncateUndoAbove(
  documentId: string,
  userId: string,
  seq: number,
): Promise<void> {
  const { error } = await supabase
    .from('undo_entries')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .gt('seq', seq);
  if (error) console.warn('undo truncate failed', error.message);
}

/** Keep only the newest `keep` steps. */
export async function pruneUndoHistory(
  documentId: string,
  userId: string,
  keep: number,
): Promise<void> {
  const { data, error } = await supabase
    .from('undo_entries')
    .select('seq')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .order('seq', { ascending: false })
    .limit(keep);
  if (error || !data || data.length < keep) return;
  const oldestKept = Number(data[data.length - 1].seq);
  const { error: delErr } = await supabase
    .from('undo_entries')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .lt('seq', oldestKept);
  if (delErr) console.warn('undo prune failed', delErr.message);
}

export async function clearUndoHistory(documentId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('undo_entries')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId);
  if (error) console.warn('undo clear failed', error.message);
}

/** Wipe this user's history across every document. */
export async function clearAllUndoHistory(userId: string): Promise<void> {
  const { error } = await supabase.from('undo_entries').delete().eq('user_id', userId);
  if (error) throw error;
}
