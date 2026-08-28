import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCrumbs } from '../components/AppShell';
import { flagColor, flagLabel } from '../lib/flags';
import { useDialog } from '../components/Dialog';
import { GridPreview } from '../components/GridPreview';
import {
  IconDispatch,
  IconLock,
  IconMessage,
  IconPlus,
  IconSettings,
  IconShare,
  IconTrash,
  IconUnlink,
} from '../components/Icons';
import {
  DocumentSettingsPanel,
  type DocumentSettingsValues,
} from '../components/DocumentSettingsPanel';
import { DispatchPanel, type DispatchArgs } from '../components/DispatchPanel';
import { ShareModal } from '../components/ShareModal';
import { NewAdaptationPanel } from '../components/NewAdaptationPanel';
import { canvasAspect, effectiveColumns } from '../grid/presets';
import { clampPos, rescalePages } from '../lib/blocks';
import {
  buildDocTree,
  canHaveChild,
  flattenDocTree,
  LIN_COL,
  MAX_ADAPTATION_DEPTH,
  railColumn,
  type FlatDoc,
} from '../lib/doctree';
import {
  buildDispatchTargets,
  lockBlocking,
  versionName,
  type DispatchCandidate,
  type DispatchTarget,
} from '../lib/dispatch';
import { newId } from '../lib/ids';
import {
  cloneForAdaptation,
  collectUpstream,
  collectUsages,
  stripAllBindings,
  toFieldMap,
} from '../lib/syncfields';
import { useAuth } from '../store/auth';
import {
  createDocument,
  deleteDocument,
  fetchDocuments,
  updateDocumentMeta,
} from '../store/documents';
import { fetchCommentCounts } from '../store/comments';
import { fetchDispatchCandidates, runDispatch } from '../store/dispatch';
import { fetchDraft, saveDraft } from '../store/drafts';
import { fetchFieldsForProject } from '../store/fields';
import { fetchProject, updateProjectMeta } from '../store/projects';
import { useSpaces } from '../store/spaces';
import { fetchVersion } from '../store/versions';
import type { DispatchDocument, GridConfig, Page, Project, SyncField } from '../types';

interface DocRow {
  doc: DispatchDocument;
  pages: Page[];
  usageCount: number;
  pendingCount: number;
}

type Filter = 'all' | 'master' | 'adaptation';

/** Human name for a document's position in the lineage. */
function depthLabel(depth: number): string {
  if (depth <= 0) return 'Master';
  return depth === 1 ? 'Adaptation' : 'Sub-adaptation';
}

/** Thumbnail box — a fixed frame keeps every card the same height. */
const THUMB_W = 68;
const THUMB_H = 46;

export function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const { setCrumbs } = useCrumbs();
  const { canEdit } = useSpaces();
  const { user } = useAuth();
  const navigate = useNavigate();
  const dialog = useDialog();

  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [fields, setFields] = useState<SyncField[]>([]);
  const [comments, setComments] = useState<Map<string, { total: number; open: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  /** Parent the "new adaptation" panel is deriving from. */
  const [newParent, setNewParent] = useState<DispatchDocument | null>(null);
  /** Document whose settings panel is open. */
  const [settingsFor, setSettingsFor] = useState<DispatchDocument | null>(null);
  /** Document whose share dialog is open. */
  const [shareFor, setShareFor] = useState<DispatchDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  /** Document a dispatch is being composed from, and what it will reach. */
  const [dispatchFrom, setDispatchFrom] = useState<DispatchDocument | null>(null);
  const [dispatchTargets, setDispatchTargets] = useState<DispatchTarget[] | null>(null);
  const [dispatchPages, setDispatchPages] = useState<Page[] | null>(null);
  const [dispatchVersion, setDispatchVersion] = useState<string | null>(null);
  const [dispatchBusy, setDispatchBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const proj = await fetchProject(projectId);
      if (!proj) {
        setProject(null);
        return;
      }
      const [docs, flds] = await Promise.all([
        fetchDocuments(projectId),
        fetchFieldsForProject(projectId, proj.spaceId),
      ]);
      setProject(proj);
      setFields(flds);
      const fieldMap = toFieldMap(flds);
      const withDrafts = await Promise.all(
        docs.map(async (doc) => {
          const draft = await fetchDraft(doc.id);
          const pages = draft?.pages ?? [];
          const pending = collectUpstream(pages, fieldMap);
          return {
            doc,
            pages,
            usageCount: collectUsages(pages).length,
            pendingCount: pending.fields.length + pending.blocks.length,
          };
        }),
      );
      setRows(withDrafts);
      setComments(await fetchCommentCounts(docs.map((d) => d.id)));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setCrumbs([
      <Link key="p" to="/">
        Projects
      </Link>,
      project?.title ?? '…',
    ]);
  }, [setCrumbs, project]);

  const tree = useMemo(() => buildDocTree(rows), [rows]);
  const flat = useMemo<FlatDoc<DocRow>[]>(() => {
    const out: FlatDoc<DocRow>[] = [];
    if (tree.master) flattenDocTree(tree.master, out);
    // Detached adaptations render at depth 1 with no ancestor rails.
    tree.orphans.forEach((o, i) => flattenDocTree(o, out, i === tree.orphans.length - 1, []));
    return out;
  }, [tree]);

  const visible = useMemo(
    () =>
      flat.filter(({ node }) => {
        if (filter === 'all') return true;
        if (filter === 'master') return node.doc.doc.kind === 'master';
        return node.doc.doc.kind === 'adaptation';
      }),
    [flat, filter],
  );

  // buildDocTree wraps rows, so unwrap twice to reach the document.
  const master = tree.master?.doc.doc ?? null;
  const adaptationCount = rows.filter((r) => r.doc.kind === 'adaptation').length;

  /** Derive a new adaptation from `parent` (the master or an adaptation). */
  const createAdaptation = async (args: { title: string; grid: GridConfig }) => {
    const parent = newParent;
    if (!parent || !user || !projectId) return;
    const parentRow = rows.find((r) => r.doc.id === parent.id);
    if (!parentRow) return;
    setBusy(true);
    try {
      // Clone the PARENT's pages; every block gets a `down` binding to its
      // source there, so a chain of adaptations each follows its own parent.
      const cloned = cloneForAdaptation(
        parentRow.pages,
        () => newId('blk'),
        () => newId('pg'),
      );
      const clamped = cloned.map((page) => {
        const cols = effectiveColumns(args.grid, page.kind);
        return {
          ...page,
          blocks: page.blocks.map((b) => ({ ...b, pos: clampPos(b.pos, cols, args.grid.rows) })),
        };
      });
      const doc = await createDocument({
        projectId,
        kind: 'adaptation',
        parentId: parent.id,
        title: args.title,
        grid: args.grid,
        userId: user.uid,
        pages: clamped,
      });
      setNewParent(null);
      navigate(`/docs/${doc.id}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Save one document's settings. A refined grid rescales only that
   * document's blocks; siblings and the master are untouched. Editing the
   * master's title renames the project too — they are the same thing.
   */
  const saveSettings = async (values: DocumentSettingsValues) => {
    const target = settingsFor;
    if (!target || !user || !projectId) return;
    setBusy(true);
    try {
      const isMaster = target.kind === 'master';
      if (isMaster) {
        await updateProjectMeta(projectId, {
          title: values.title,
          ...(values.type !== undefined ? { type: values.type } : {}),
        });
      }
      const oldGrid = target.grid;
      const gridChanged = JSON.stringify(oldGrid) !== JSON.stringify(values.grid);
      if (gridChanged) {
        await updateDocumentMeta(target.id, { title: values.title, grid: values.grid });
        const draft = await fetchDraft(target.id);
        if (draft) {
          await saveDraft(target.id, rescalePages(draft.pages, oldGrid, values.grid), user.uid);
        }
      } else if (values.title !== target.title) {
        await updateDocumentMeta(target.id, { title: values.title });
      }
      setSettingsFor(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  /* ---------- Dispatch ----------
     From here a dispatch only PROPAGATES: it pushes the content the
     document already holds down to the adaptations that follow it. The
     version is not being written, so it is shown rather than named —
     what the adaptations end up following. */

  const openDispatch = async (doc: DispatchDocument) => {
    if (!user || !projectId) return;
    setDispatchFrom(doc);
    setDispatchTargets(null);
    setDispatchPages(null);
    setDispatchVersion(null);
    try {
      // Re-read rather than trusting the loaded rows: locks and drafts
      // move while this page sits open, and both decide what can land.
      const candidates: DispatchCandidate[] = await fetchDispatchCandidates(projectId);
      setDispatchTargets(buildDispatchTargets(doc.id, candidates, user.uid, Date.now()));
      setDispatchPages(candidates.find((c) => c.doc.id === doc.id)?.pages ?? []);
      if (doc.currentVersionId) {
        const v = await fetchVersion(doc.currentVersionId);
        if (v) setDispatchVersion(versionName(v.number, v.label));
      } else if (doc.versionCount > 0) {
        setDispatchVersion(versionName(doc.versionCount));
      }
    } catch (e) {
      console.error('dispatch targets failed', e);
      setDispatchTargets([]);
    }
  };

  const confirmDispatch = async ({ targetIds }: DispatchArgs) => {
    const source = dispatchFrom;
    if (!user || !projectId || !project || !source) return;
    const chosen = (dispatchTargets ?? [])
      .filter((t) => targetIds.includes(t.doc.id))
      .map((t) => t.doc);
    if (chosen.length === 0) return;
    setDispatchBusy(true);
    try {
      await runDispatch({
        projectId,
        spaceId: project.spaceId,
        source: { id: source.id, pages: dispatchPages ?? [] },
        targets: chosen,
        userId: user.uid,
      });
      setDispatchFrom(null);
      await load();
    } catch (e) {
      console.error(e);
      await dialog.alert('Dispatch failed', { message: String(e) });
    } finally {
      setDispatchBusy(false);
    }
  };

  /** Detach every descendant so deleting a parent never orphans bindings. */
  const detachChildren = async (parentId: string) => {
    if (!user) return;
    const kids = rows.filter((r) => r.doc.parentId === parentId);
    for (const kid of kids) {
      const draft = await fetchDraft(kid.doc.id);
      if (draft) await saveDraft(kid.doc.id, stripAllBindings(draft.pages), user.uid);
      await updateDocumentMeta(kid.doc.id, { parentId: null });
    }
  };

  const removeDoc = async (row: DocRow) => {
    if (!user) return;
    const kids = rows.filter((r) => r.doc.parentId === row.doc.id);
    const isMaster = row.doc.kind === 'master';
    const ok = await dialog.confirm(
      isMaster ? `Delete master “${row.doc.title}”?` : `Delete “${row.doc.title}”?`,
      {
        message: kids.length
          ? `${kids.length} adaptation(s) derived from it will be unlinked and keep plain copies of their content. This cannot be undone.`
          : 'This cannot be undone.',
        confirmLabel: isMaster ? 'Delete master' : 'Delete',
        danger: true,
      },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await detachChildren(row.doc.id);
      await deleteDocument(row.doc.id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  /** Detach an adaptation from its parent without deleting anything. */
  const detachFromParent = async (row: DocRow) => {
    if (!user) return;
    const ok = await dialog.confirm(`Detach “${row.doc.title}” from its parent?`, {
      message: 'It keeps its current content as a plain copy and stops following the parent.',
      confirmLabel: 'Detach',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const draft = await fetchDraft(row.doc.id);
      if (draft) await saveDraft(row.doc.id, stripAllBindings(draft.pages), user.uid);
      await updateDocumentMeta(row.doc.id, { parentId: null });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="content-pad">
        <p className="muted">Project not found (or you don&apos;t have access).</p>
      </div>
    );
  }

  return (
    <div className="content-pad" style={{ maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {flagColor(project.flag) && (
              <span
                className="pj-flag-dot"
                style={{ ['--pj-flag' as string]: flagColor(project.flag) } as React.CSSProperties}
                title={flagLabel(project.flag) ?? undefined}
              />
            )}
            <h2>{project.title}</h2>
          </div>
          <div className="muted text-xs">
            {project.folder ? `${project.folder} · ` : ''}
            {project.type || 'Project'} · {adaptationCount} adaptation
            {adaptationCount === 1 ? '' : 's'} · {fields.length} sync field
            {fields.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="segmented">
          {(['all', 'master', 'adaptation'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'master' ? 'Master' : 'Adaptations'}
            </button>
          ))}
        </div>

      </div>

      <p className="muted text-xs" style={{ margin: '8px 0 18px' }}>
        Each adaptation follows the document directly above it in the tree. Adaptations can be
        derived from other adaptations, up to {MAX_ADAPTATION_DEPTH} levels below the master.
      </p>

      {!master && rows.length === 0 && <p className="muted">This project has no documents.</p>}

      <div className="lineage">
        {visible.map(({ node, isLast, rails }) => {
          const row = node.doc;
          const doc = row.doc;
          const isMaster = doc.kind === 'master';
          const parentRow = doc.parentId ? rows.find((r) => r.doc.id === doc.parentId) : null;
          const allowChild = canHaveChild(node.depth);

          return (
            <div
              key={doc.id}
              className={`lin-item depth-${node.depth}`}
              style={{ ['--lin-depth' as string]: node.depth }}
            >
              {/* Ancestor rails passing this row, plus this row's own elbow. */}
              {rails.map((x) => (
                <span key={x} className="lin-rail" style={{ left: x }} />
              ))}
              {node.depth > 0 && (
                <>
                  <span className="lin-elbow" style={{ left: railColumn(node.depth) }} />
                  {!isLast && (
                    <span className="lin-rail continues" style={{ left: railColumn(node.depth) }} />
                  )}
                </>
              )}

              <div
                className={`lin-card ${isMaster ? 'is-master' : ''} ${doc.lock ? 'is-locked' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/docs/${doc.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/docs/${doc.id}`)}
              >
                <div className="lin-thumb">
                  {/* Fit inside a fixed frame so the row height never varies
                      with the document's page proportions. */}
                  <GridPreview
                    grid={doc.grid}
                    page={row.pages[0]}
                    width={Math.min(THUMB_W, THUMB_H * canvasAspect(doc.grid, 'single'))}
                    showGrid={false}
                  />
                </div>

                <div className="lin-body">
                  <div className="lin-title-row">
                    <span className="lin-title">{doc.title}</span>
                    <span className={`pill ${isMaster ? 'pill-accent' : ''}`}>
                      {depthLabel(node.depth)}
                    </span>
                    {doc.lock && (
                      <span className="pill pill-primary">
                        <IconLock size={10} /> {doc.lock.displayName}
                      </span>
                    )}
                  </div>
                  <div className="lin-meta">
                    {doc.grid.pageSize} {doc.grid.orientation} · {doc.grid.columns}×{doc.grid.rows} ·{' '}
                    {row.pages.length} page{row.pages.length === 1 ? '' : 's'} · v{doc.versionCount}
                  </div>
                  {isMaster ? (
                    <div className="lin-lineage">
                      Root document — every adaptation derives from this
                    </div>
                  ) : parentRow ? (
                    <div className="lin-lineage">
                      Adaptation of <strong>{parentRow.doc.title}</strong>
                    </div>
                  ) : (
                    <div className="lin-lineage detached">Detached — no parent</div>
                  )}
                </div>

                <div className="lin-right" onClick={(e) => e.stopPropagation()}>
                  <div className="lin-stats">
                    {isMaster ? (
                      <span className="pill">{fields.length} fields</span>
                    ) : (
                      <>
                        {row.pendingCount > 0 && (
                          <span className="pill pill-warning">{row.pendingCount} pending ↑</span>
                        )}
                        <span className="pill pill-success">{row.usageCount} synced</span>
                      </>
                    )}
                  </div>

                  {canEdit && node.children.length > 0 && (
                    <button
                      className="lin-dispatch"
                      title={`Push ${doc.title}'s shared content to the adaptations below it`}
                      onClick={() => void openDispatch(doc)}
                      disabled={busy}
                    >
                      <IconDispatch size={12} /> Dispatch
                    </button>
                  )}

                  <div className="lin-actions">
                    <button
                      className={`lin-act ${(comments.get(doc.id)?.open ?? 0) > 0 ? 'has-open' : ''}`}
                      title={
                        comments.get(doc.id)
                          ? `${comments.get(doc.id)!.total} comment(s), ${comments.get(doc.id)!.open} open`
                          : 'No comments yet'
                      }
                      aria-label={`Comments on ${doc.title}`}
                      onClick={() => navigate(`/docs/${doc.id}?tab=comments`)}
                    >
                      <IconMessage size={13} />
                      <span>{comments.get(doc.id)?.total ?? 0}</span>
                    </button>

                    <button
                      className="icon-btn"
                      title={`Share ${doc.title}`}
                      aria-label={`Share ${doc.title}`}
                      onClick={() => setShareFor(doc)}
                    >
                      <IconShare size={14} />
                    </button>

                    {canEdit ? (
                      <>
                        <button
                          className="icon-btn"
                          title={
                            allowChild
                              ? `Derive an adaptation from ${doc.title}`
                              : `Maximum depth reached (${MAX_ADAPTATION_DEPTH} levels)`
                          }
                          aria-label={`New adaptation from ${doc.title}`}
                          onClick={() => setNewParent(doc)}
                          disabled={busy || !allowChild}
                        >
                          <IconPlus size={14} />
                        </button>
                        <button
                          className="icon-btn"
                          title={`${doc.title} settings`}
                          aria-label={`Settings for ${doc.title}`}
                          onClick={() => setSettingsFor(doc)}
                          disabled={busy}
                        >
                          <IconSettings size={14} />
                        </button>
                        {!isMaster && doc.parentId && (
                          <button
                            className="icon-btn"
                            title="Detach from parent"
                            aria-label={`Detach ${doc.title}`}
                            onClick={() => void detachFromParent(row)}
                            disabled={busy}
                          >
                            <IconUnlink size={14} />
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          title={isMaster ? 'Delete master' : 'Delete adaptation'}
                          aria-label={`Delete ${doc.title}`}
                          onClick={() => void removeDoc(row)}
                          disabled={busy}
                        >
                          <IconTrash size={14} />
                        </button>
                      </>
                    ) : (
                      <span className="lin-actions-spacer" />
                    )}
                  </div>
                </div>
              </div>

              {/* An explicit affordance at the deepest allowed level. */}
              {canEdit && allowChild && node.children.length === 0 && filter !== 'master' && (
                <button
                  className="lin-add"
                  style={{ marginLeft: node.depth * LIN_COL + LIN_COL }}
                  onClick={() => setNewParent(doc)}
                  disabled={busy}
                >
                  <IconPlus size={12} /> New adaptation from {doc.title}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {settingsFor && (
        <DocumentSettingsPanel
          doc={settingsFor}
          isMaster={settingsFor.kind === 'master'}
          projectType={project.type}
          onSubmit={(v) => void saveSettings(v)}
          onClose={() => setSettingsFor(null)}
          busy={busy}
        />
      )}

      {dispatchFrom && (
        <DispatchPanel
          source={dispatchFrom}
          mode="propagate"
          targets={dispatchTargets ?? []}
          loading={dispatchTargets === null}
          currentVersion={dispatchVersion}
          sourceLockedBy={user ? lockBlocking(dispatchFrom, user.uid, Date.now()) : null}
          onDispatch={(a) => void confirmDispatch(a)}
          onClose={() => !dispatchBusy && setDispatchFrom(null)}
          busy={dispatchBusy}
        />
      )}

      {shareFor && (
        <ShareModal doc={shareFor} onClose={() => setShareFor(null)} />
      )}

      {newParent && (
        <NewAdaptationPanel
          parent={newParent}
          onCreate={(a) => void createAdaptation(a)}
          onClose={() => setNewParent(null)}
          busy={busy}
        />
      )}
    </div>
  );
}
