import { supabase } from '../lib/supabase';
import type { DocComment } from '../types';

export function mapComment(r: Record<string, unknown>): DocComment {
  return {
    id: r.id as string,
    documentId: r.document_id as string,
    blockId: (r.block_id as string | null) ?? null,
    body: r.body as string,
    authorId: r.author_id as string,
    authorName: (r.author_name as string) ?? '',
    resolved: (r.resolved as boolean) ?? false,
    createdAt: r.created_at as string,
  };
}

export async function fetchComments(documentId: string): Promise<DocComment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapComment);
}

export async function addComment(args: {
  documentId: string;
  blockId?: string | null;
  body: string;
  userId: string;
  userName: string;
}): Promise<DocComment> {
  const { data, error } = await supabase
    .from('comments')
    .insert({
      document_id: args.documentId,
      block_id: args.blockId ?? null,
      body: args.body,
      author_id: args.userId,
      author_name: args.userName,
    })
    .select()
    .single();
  if (error) throw error;
  return mapComment(data);
}

export async function setCommentResolved(id: string, resolved: boolean) {
  const { error } = await supabase.from('comments').update({ resolved }).eq('id', id);
  if (error) throw error;
}

export async function deleteComment(id: string) {
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) throw error;
}

/** Unresolved + resolved comment counts per document, for list badges. */
export async function fetchCommentCounts(
  documentIds: string[],
): Promise<Map<string, { total: number; open: number }>> {
  if (documentIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('comments')
    .select('document_id, resolved')
    .in('document_id', documentIds);
  if (error) throw error;
  const out = new Map<string, { total: number; open: number }>();
  for (const r of data ?? []) {
    const id = r.document_id as string;
    const cur = out.get(id) ?? { total: 0, open: 0 };
    cur.total += 1;
    if (!r.resolved) cur.open += 1;
    out.set(id, cur);
  }
  return out;
}
