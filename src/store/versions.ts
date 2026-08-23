import { supabase } from '../lib/supabase';
import type { Page, Version } from '../types';
import { bumpVersionPointer } from './documents';
import { foldHeadings } from '../lib/blocks';

function map(r: Record<string, unknown>): Version {
  return {
    id: r.id as string,
    documentId: r.document_id as string,
    number: r.number as number,
    label: (r.label as string | null) ?? null,
    createdBy: r.created_by as string,
    createdByName: (r.created_by_name as string) ?? '',
    createdAt: r.created_at as string,
    snapshot: { pages: foldHeadings((r.snapshot as { pages: Page[] }).pages ?? []) },
  };
}

export async function fetchVersions(documentId: string): Promise<Version[]> {
  const { data, error } = await supabase
    .from('versions')
    .select('*')
    .eq('document_id', documentId)
    .order('number', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(map);
}

export async function createVersion(args: {
  documentId: string;
  number: number;
  label?: string;
  userId: string;
  userName: string;
  pages: Page[];
}): Promise<Version> {
  const { data, error } = await supabase
    .from('versions')
    .insert({
      document_id: args.documentId,
      number: args.number,
      label: args.label ?? null,
      created_by: args.userId,
      created_by_name: args.userName,
      snapshot: { pages: args.pages },
    })
    .select()
    .single();
  if (error) throw error;
  const version = map(data);
  await bumpVersionPointer(args.documentId, version.id, args.number);
  return version;
}
