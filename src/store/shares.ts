import { supabase } from '../lib/supabase';
import type { GridConfig, Page } from '../types';

export interface ShareLink {
  id: string;
  token: string;
  documentId: string;
  versionId?: string | null;
  versionNumber?: number | null;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  expiresAt?: string | null;
  requireLogin: boolean;
  allowCopy: boolean;
}

export interface SharedPublication {
  share: ShareLink;
  docTitle: string;
  docKind: 'master' | 'adaptation';
  projectTitle: string;
  grid: GridConfig;
  pages: Page[];
  versionNumber?: number | null;
  versionLabel?: string | null;
  latestVersionNumber?: number | null;
  isOlderVersion: boolean;
  requiresAuth: boolean;
  isExpired: boolean;
}

const LOCAL_SHARES_KEY = 'rmit_shares_local_v1';

function getLocalShares(): ShareLink[] {
  try {
    const raw = localStorage.getItem(LOCAL_SHARES_KEY);
    return raw ? (JSON.parse(raw) as ShareLink[]) : [];
  } catch {
    return [];
  }
}

function saveLocalShare(s: ShareLink) {
  try {
    const list = getLocalShares().filter((x) => x.id !== s.id && x.token !== s.token);
    list.unshift(s);
    localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(list));
  } catch {
    // Ignore local storage error
  }
}

function removeLocalShare(shareId: string) {
  try {
    const list = getLocalShares().filter((x) => x.id !== shareId);
    localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(list));
  } catch {
    // Ignore
  }
}

function generateRandomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createShareLink(params: {
  documentId: string;
  versionId?: string | null;
  versionNumber?: number | null;
  expiresAt?: string | null;
  requireLogin?: boolean;
  allowCopy?: boolean;
  userId: string;
  userName?: string;
}): Promise<ShareLink> {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : generateRandomToken();
  const token = generateRandomToken();
  const createdAt = new Date().toISOString();

  const share: ShareLink = {
    id,
    token,
    documentId: params.documentId,
    versionId: params.versionId ?? null,
    versionNumber: params.versionNumber ?? null,
    createdBy: params.userId,
    createdByName: params.userName || 'Author',
    createdAt,
    expiresAt: params.expiresAt ?? null,
    requireLogin: !!params.requireLogin,
    allowCopy: params.allowCopy !== false,
  };

  try {
    const { data, error } = await supabase
      .from('shares')
      .insert({
        id: share.id,
        token: share.token,
        document_id: share.documentId,
        version_id: share.versionId,
        version_number: share.versionNumber,
        created_by: share.createdBy,
        created_at: share.createdAt,
        expires_at: share.expiresAt,
        require_login: share.requireLogin,
        allow_copy: share.allowCopy,
      })
      .select()
      .single();

    if (error) {
      console.warn('Could not insert share to Supabase, saving locally:', error);
      saveLocalShare(share);
      return share;
    }

    const mapped: ShareLink = {
      id: data.id,
      token: data.token,
      documentId: data.document_id,
      versionId: data.version_id,
      versionNumber: data.version_number,
      createdBy: data.created_by,
      createdByName: params.userName || 'Author',
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      requireLogin: data.require_login,
      allowCopy: data.allow_copy,
    };
    saveLocalShare(mapped);
    return mapped;
  } catch (err) {
    console.warn('Supabase share insert exception:', err);
    saveLocalShare(share);
    return share;
  }
}

export async function fetchDocShares(documentId: string): Promise<ShareLink[]> {
  try {
    const { data, error } = await supabase
      .from('shares')
      .select('*')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      return getLocalShares().filter((s) => s.documentId === documentId);
    }

    return data.map((d) => ({
      id: d.id,
      token: d.token,
      documentId: d.document_id,
      versionId: d.version_id,
      versionNumber: d.version_number,
      createdBy: d.created_by,
      createdAt: d.created_at,
      expiresAt: d.expires_at,
      requireLogin: d.require_login,
      allowCopy: d.allow_copy,
    }));
  } catch {
    return getLocalShares().filter((s) => s.documentId === documentId);
  }
}

export async function deleteShareLink(shareId: string): Promise<void> {
  removeLocalShare(shareId);
  try {
    await supabase.from('shares').delete().eq('id', shareId);
  } catch (err) {
    console.warn('Failed to delete share on Supabase:', err);
  }
}

export async function fetchShareByToken(
  token: string,
  currentUser: unknown | null,
): Promise<SharedPublication | null> {
  let share: ShareLink | null = null;

  try {
    const { data, error } = await supabase.from('shares').select('*').eq('token', token).maybeSingle();
    if (!error && data) {
      share = {
        id: data.id,
        token: data.token,
        documentId: data.document_id,
        versionId: data.version_id,
        versionNumber: data.version_number,
        createdBy: data.created_by,
        createdAt: data.created_at,
        expiresAt: data.expires_at,
        requireLogin: data.require_login,
        allowCopy: data.allow_copy,
      };
    }
  } catch {
    // Fallback to local
  }

  if (!share) {
    share = getLocalShares().find((s) => s.token === token) ?? null;
  }

  if (!share) return null;

  const isExpired = !!share.expiresAt && new Date(share.expiresAt).getTime() < Date.now();
  const requiresAuth = share.requireLogin && !currentUser;

  if (isExpired || requiresAuth) {
    return {
      share,
      docTitle: 'Publication',
      docKind: 'master',
      projectTitle: '',
      grid: {
        pageSize: 'A4',
        orientation: 'portrait',
        columns: 24,
        rows: 34,
        marginMm: 12,
        gutterMm: 4,
        spineMm: 6,
      },
      pages: [],
      isOlderVersion: false,
      requiresAuth,
      isExpired,
    };
  }

  // Fetch document details
  const { data: doc } = await supabase
    .from('documents')
    .select('*, projects(title)')
    .eq('id', share.documentId)
    .single();

  const docTitle = doc?.title || 'Publication';
  const docKind = (doc?.kind || 'master') as 'master' | 'adaptation';
  const projectTitle = doc?.projects?.title || '';
  const grid = doc?.grid as GridConfig;

  // Query latest version count
  const { data: latestV } = await supabase
    .from('versions')
    .select('id, number, label')
    .eq('document_id', share.documentId)
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestVersionNumber = latestV?.number ?? doc?.version_count ?? 1;

  let pages: Page[] = [];
  let versionNumber: number | null = share.versionNumber ?? null;
  let versionLabel: string | null = null;

  if (share.versionId) {
    // Fetch snapshot from version
    const { data: vData } = await supabase
      .from('versions')
      .select('number, label, snapshot')
      .eq('id', share.versionId)
      .single();

    if (vData) {
      versionNumber = vData.number;
      versionLabel = vData.label;
      const snap = vData.snapshot as { pages?: Page[] } | Page[];
      pages = Array.isArray(snap) ? snap : snap?.pages ?? [];
    }
  }

  // Fallback to draft pages if not pinned to a specific version snapshot
  if (!pages.length) {
    const { data: draftData } = await supabase
      .from('drafts')
      .select('pages')
      .eq('document_id', share.documentId)
      .maybeSingle();

    if (draftData?.pages && Array.isArray(draftData.pages)) {
      pages = draftData.pages as Page[];
    }
  }

  const isOlderVersion =
    versionNumber != null && latestVersionNumber != null && versionNumber < latestVersionNumber;

  return {
    share,
    docTitle,
    docKind,
    projectTitle,
    grid: grid || {
      pageSize: 'A4',
      orientation: 'portrait',
      columns: 24,
      rows: 34,
      marginMm: 12,
      gutterMm: 4,
      spineMm: 6,
    },
    pages,
    versionNumber,
    versionLabel,
    latestVersionNumber,
    isOlderVersion,
    requiresAuth: false,
    isExpired: false,
  };
}
