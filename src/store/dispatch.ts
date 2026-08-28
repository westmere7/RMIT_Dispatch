import { applySyncDown, toFieldMap } from '../lib/syncfields';
import type { Block, DispatchDocument, Page } from '../types';
import type { DispatchCandidate, DispatchOutcome } from '../lib/dispatch';
import { fetchDocuments } from './documents';
import { fetchDraft, saveDraftIfWritable } from './drafts';
import { fetchFieldsForProject } from './fields';

/* ============================================================
   Running a dispatch: resolve each selected adaptation against
   the current field values and its parent's content, then write
   the result to its draft. Realtime carries it to anyone who
   has the document open.
   ============================================================ */

function blockMap(pages: Page[] | null): Map<string, Block> | null {
  if (!pages) return null;
  return new Map(pages.flatMap((p) => p.blocks.map((b) => [b.id, b] as const)));
}

/** Every document in the project with its draft — the dispatch planner's input. */
export async function fetchDispatchCandidates(projectId: string): Promise<DispatchCandidate[]> {
  const docs = await fetchDocuments(projectId);
  return Promise.all(
    docs.map(async (doc) => ({ doc, pages: (await fetchDraft(doc.id))?.pages ?? [] })),
  );
}

/**
 * Push `source`'s shared content to `targets`, which MUST be in tree
 * order (a parent before its own children): a sub-adaptation resolves
 * against its parent's freshly dispatched pages, so the order is what
 * carries a change to the bottom of a chain in one pass.
 *
 * Field values are re-read from the database rather than taken from the
 * caller's state: a dispatch normally follows an upstream push, and the
 * adaptations must receive what was just written, not what the sender
 * happened to be holding.
 */
export async function runDispatch(args: {
  projectId: string;
  spaceId: string;
  source: { id: string; pages: Page[] };
  targets: DispatchDocument[];
  userId: string;
}): Promise<DispatchOutcome[]> {
  const fieldMap = toFieldMap(await fetchFieldsForProject(args.projectId, args.spaceId));
  /** Pages as each document now stands, so children resolve against them. */
  const resolved = new Map<string, Page[]>([[args.source.id, args.source.pages]]);
  const out: DispatchOutcome[] = [];

  for (const doc of args.targets) {
    const draft = await fetchDraft(doc.id);
    if (!draft) {
      out.push({ documentId: doc.id, title: doc.title, status: 'missing' });
      continue;
    }
    // A target whose own parent was left out still follows that parent's
    // current content — only its sync fields carry the source's change.
    let parentPages = doc.parentId ? (resolved.get(doc.parentId) ?? null) : null;
    if (!parentPages && doc.parentId) parentPages = (await fetchDraft(doc.parentId))?.pages ?? null;

    const next = applySyncDown(draft.pages, fieldMap, blockMap(parentPages) ?? undefined);
    resolved.set(doc.id, next);

    if (JSON.stringify(next) === JSON.stringify(draft.pages)) {
      out.push({ documentId: doc.id, title: doc.title, status: 'unchanged' });
      continue;
    }
    const written = await saveDraftIfWritable(doc.id, next, args.userId);
    out.push({
      documentId: doc.id,
      title: doc.title,
      // Not written means the lock check in the drafts policy refused it.
      status: written ? 'updated' : 'locked',
    });
    // Someone else's editing session owns that draft; its children must
    // keep following what is actually stored there, not our resolution.
    if (!written) resolved.set(doc.id, draft.pages);
  }

  return out;
}
