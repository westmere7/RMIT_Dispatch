import type { DispatchDocument } from '../types';

/* ============================================================
   Master → adaptation lineage. An adaptation's parent may be the
   master OR another adaptation, which is what allows a second
   layer. Depth 0 is the master; adaptations may reach MAX_DEPTH.
   ============================================================ */

export const MAX_ADAPTATION_DEPTH = 2;

export interface DocNode<T> {
  doc: T;
  depth: number;
  children: DocNode<T>[];
}

/**
 * Build the lineage tree from a flat document list. Adaptations whose
 * parent is missing (e.g. the master was deleted) are attached at the
 * top so they never vanish from the view.
 */
export function buildDocTree<T extends { doc: DispatchDocument }>(
  rows: T[],
): { master: DocNode<T> | null; orphans: DocNode<T>[] } {
  const byId = new Map(rows.map((r) => [r.doc.id, r]));
  const childrenOf = new Map<string, T[]>();
  const masterRow = rows.find((r) => r.doc.kind === 'master') ?? null;
  const orphanRows: T[] = [];

  for (const r of rows) {
    if (r.doc.kind === 'master') continue;
    const parentId = r.doc.parentId ?? null;
    if (parentId && byId.has(parentId)) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(r);
      childrenOf.set(parentId, list);
    } else {
      orphanRows.push(r);
    }
  }

  const build = (row: T, depth: number, seen: Set<string>): DocNode<T> => {
    // Guard against a cycle introduced by bad data.
    if (seen.has(row.doc.id)) return { doc: row, depth, children: [] };
    const next = new Set(seen).add(row.doc.id);
    const kids = (childrenOf.get(row.doc.id) ?? []).sort((a, b) =>
      a.doc.title.localeCompare(b.doc.title),
    );
    return { doc: row, depth, children: kids.map((k) => build(k, depth + 1, next)) };
  };

  return {
    master: masterRow ? build(masterRow, 0, new Set()) : null,
    orphans: orphanRows
      .sort((a, b) => a.doc.title.localeCompare(b.doc.title))
      .map((r) => build(r, 1, new Set())),
  };
}

/* ---------- Connector geometry ----------
   Each depth level owns a 30px column; its rail sits at the column's
   midpoint so elbows meet the child card's left edge. */

export const LIN_COL = 30;
export const LIN_MID = 15;

/** X position of the connector rail belonging to a node at this depth. */
export function railColumn(depth: number): number {
  return (depth - 1) * LIN_COL + LIN_MID;
}

export interface FlatDoc<T> {
  node: DocNode<T>;
  isLast: boolean;
  /** Columns where an ANCESTOR's rail must continue past this row. */
  rails: number[];
}

/**
 * Flatten to render order. A node passes its own column down to its
 * descendants when it still has siblings below, so the vertical line
 * runs past the whole subtree instead of breaking at each child.
 */
export function flattenDocTree<T>(
  node: DocNode<T>,
  out: FlatDoc<T>[] = [],
  isLast = true,
  rails: number[] = [],
): FlatDoc<T>[] {
  out.push({ node, isLast, rails });
  const childRails = node.depth >= 1 && !isLast ? [...rails, railColumn(node.depth)] : rails;
  node.children.forEach((child, i) => {
    flattenDocTree(child, out, i === node.children.length - 1, childRails);
  });
  return out;
}

/** Can this document take another adaptation beneath it? */
export function canHaveChild(depth: number): boolean {
  return depth < MAX_ADAPTATION_DEPTH;
}
