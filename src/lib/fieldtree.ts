import type { FieldScope, SyncField } from '../types';

/* ============================================================
   Folder organisation for sync fields. A field's `folder` is a
   plain '/'-separated path ('' = root); the tree is derived, so
   there are no folder rows to keep in sync in the database.
   ============================================================ */

export interface FolderNode {
  /** Full path, e.g. "Pricing/2026". '' for the root. */
  path: string;
  /** Last segment, e.g. "2026". */
  name: string;
  children: FolderNode[];
  fields: SyncField[];
  /** Fields in this folder and everything under it. */
  totalCount: number;
}

export function normalizeFolder(input: string): string {
  return input
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
}

export function folderSegments(path: string): string[] {
  return path ? path.split('/') : [];
}

export function parentFolder(path: string): string {
  const segs = folderSegments(path);
  segs.pop();
  return segs.join('/');
}

/** Build a folder tree from a flat field list. */
export function buildFolderTree(fields: SyncField[]): FolderNode {
  const root: FolderNode = { path: '', name: '', children: [], fields: [], totalCount: 0 };

  const ensure = (path: string): FolderNode => {
    if (!path) return root;
    const segs = folderSegments(path);
    let node = root;
    let acc = '';
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = node.children.find((c) => c.name === seg);
      if (!next) {
        next = { path: acc, name: seg, children: [], fields: [], totalCount: 0 };
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };

  for (const f of fields) ensure(normalizeFolder(f.folder)).fields.push(f);

  const finish = (n: FolderNode): number => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.fields.sort((a, b) => a.name.localeCompare(b.name));
    n.totalCount = n.fields.length + n.children.reduce((sum, c) => sum + finish(c), 0);
    return n.totalCount;
  };
  finish(root);
  return root;
}

/** Every distinct folder path present, plus their ancestors, sorted. */
export function allFolderPaths(fields: SyncField[]): string[] {
  const set = new Set<string>();
  for (const f of fields) {
    const segs = folderSegments(normalizeFolder(f.folder));
    let acc = '';
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      set.add(acc);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Split by scope — global fields are listed above project-local ones. */
export function byScope(fields: SyncField[]): Record<FieldScope, SyncField[]> {
  return {
    global: fields.filter((f) => f.scope === 'global'),
    local: fields.filter((f) => f.scope !== 'global'),
  };
}

export function matchesQuery(f: SyncField, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    f.name.toLowerCase().includes(needle) || f.folder.toLowerCase().includes(needle)
  );
}
