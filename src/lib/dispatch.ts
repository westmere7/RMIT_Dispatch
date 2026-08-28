import type { DispatchDocument, Page } from '../types';
import { inboundSyncCount } from './syncfields';

/* ============================================================
   Dispatch — pushing a document's shared content down its
   lineage. The sync engine (`syncfields.ts`) decides WHAT a
   document receives; this module decides WHO receives it and
   whether the write can land at all.
   ============================================================ */

/**
 * A lock older than this counts as abandoned. Mirrors
 * `doc_lock_state`'s `stale` branch in `supabase/schema.sql` — the
 * database is the authority, so the two must agree or the panel would
 * offer (or refuse) writes that RLS then decides differently.
 */
export const STALE_LOCK_MS = 2 * 60_000;

/**
 * Who is holding this document open against us, if anyone. Null when the
 * draft is writable: nobody holds it, we hold it ourselves, or the lock
 * has gone stale.
 */
export function lockBlocking(
  doc: DispatchDocument,
  viewerUid: string,
  now: number,
): string | null {
  const lock = doc.lock;
  if (!lock || lock.uid === viewerUid) return null;
  if (now - new Date(lock.at).getTime() > STALE_LOCK_MS) return null;
  return lock.displayName || 'another editor';
}

/** A document plus its draft — everything needed to plan a dispatch. */
export interface DispatchCandidate {
  doc: DispatchDocument;
  pages: Page[];
}

export interface DispatchTarget {
  doc: DispatchDocument;
  /** Levels below the source: 1 is a direct adaptation. */
  depth: number;
  /** Title of the document this one actually follows. */
  parentTitle: string;
  /**
   * How many embeds here take their content from upstream. Zero means the
   * adaptation carries nothing from the source and a dispatch to it is a
   * no-op — worth saying out loud rather than reporting "0 changed".
   */
  syncedCount: number;
  /** Display name of the lock holder blocking the write, if any. */
  blockedBy: string | null;
}

/**
 * Every descendant of `sourceId`, in tree order — a parent always comes
 * before its own children, which is the order a dispatch has to run in:
 * a sub-adaptation follows its parent, so the parent must be resolved
 * first for the source's content to reach the bottom of the chain.
 */
export function buildDispatchTargets(
  sourceId: string,
  candidates: DispatchCandidate[],
  viewerUid: string,
  now: number,
): DispatchTarget[] {
  const childrenOf = new Map<string, DispatchCandidate[]>();
  for (const c of candidates) {
    const parentId = c.doc.parentId;
    if (!parentId) continue;
    const list = childrenOf.get(parentId) ?? [];
    list.push(c);
    childrenOf.set(parentId, list);
  }

  const out: DispatchTarget[] = [];
  const seen = new Set<string>([sourceId]);

  const walk = (parentId: string, parentTitle: string, depth: number) => {
    const kids = (childrenOf.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.doc.title.localeCompare(b.doc.title));
    for (const kid of kids) {
      // Bad data could point a document at its own ancestor.
      if (seen.has(kid.doc.id)) continue;
      seen.add(kid.doc.id);
      out.push({
        doc: kid.doc,
        depth,
        parentTitle,
        syncedCount: inboundSyncCount(kid.pages),
        blockedBy: lockBlocking(kid.doc, viewerUid, now),
      });
      walk(kid.doc.id, kid.doc.title, depth + 1);
    }
  };

  const source = candidates.find((c) => c.doc.id === sourceId);
  walk(sourceId, source?.doc.title ?? '', 1);
  return out;
}

/** How a version reads everywhere it is shown: `v3`, or `v3 — Launch`. */
export function versionName(number: number, label?: string | null): string {
  return `v${number}${label ? ` — ${label}` : ''}`;
}

/* ---------- Outcomes ---------- */

export type DispatchStatus = 'updated' | 'unchanged' | 'locked' | 'missing';

export interface DispatchOutcome {
  documentId: string;
  title: string;
  status: DispatchStatus;
}

/** One line summarising a run, for the confirmation that follows it. */
export function summariseDispatch(outcomes: DispatchOutcome[]): string {
  const of = (s: DispatchStatus) => outcomes.filter((o) => o.status === s);
  const parts: string[] = [`${of('updated').length} updated`];
  if (of('unchanged').length) parts.push(`${of('unchanged').length} already up to date`);
  if (of('locked').length) {
    const names = of('locked').map((o) => o.title);
    parts.push(`${names.length} skipped — being edited (${names.join(', ')})`);
  }
  if (of('missing').length) parts.push(`${of('missing').length} skipped — no draft`);
  return parts.join(' · ');
}
